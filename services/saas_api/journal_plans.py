"""Append-only, owner-authored investment/price plan revisions, NOT broker orders.

A complete revision describes the user's current target/stop intention. NULL
means intentionally unset, never market price zero. Historical revisions are
immutable and separate from broker positions/transaction assertions.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from hashlib import sha256
import json
import re
from uuid import UUID

from services.saas_api.trades import (
    TradeInputError, TradeConflict, _confirmed_scope, _runtime_safety, _tenant_scope,
)

_TICKER = re.compile(r"^[A-Z0-9.:-]{1,32}$")
_CURRENCY = re.compile(r"^[A-Z]{3}$")
_PRICE = re.compile(r"^(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$")
_MAX_PRICE = Decimal("1e24")
_LIST_LIMIT = 200
_BASE_FIELDS = frozenset((
    "idempotencyKey","ticker","targetPrice","stopPrice","priceCurrency","rationale",
))
_EXTRA_FIELDS = frozenset((
    "strategyType","investmentHorizon","invalidationCondition",
    "maxAllocationPct","reviewCadence",
))
_STRATEGIES = frozenset(("LONG_TERM","TECHNICAL","EVENT_DRIVEN","OTHER"))
_HORIZONS = frozenset((
    "UNDER_3_MONTHS","THREE_TO_TWELVE_MONTHS","ONE_TO_THREE_YEARS",
    "OVER_THREE_YEARS","OPEN_ENDED",
))
_CADENCES = frozenset((
    "WEEKLY","MONTHLY","QUARTERLY","SEMIANNUAL","ANNUAL","EVENT_DRIVEN",
))
_ALLOCATION = re.compile(r"^(?:0|[1-9][0-9]?|100)(?:\.[0-9]{1,2})?$")


def _enum(raw, choices, label):
    if raw is None:
        return None
    if not isinstance(raw,str) or raw not in choices:
        raise TradeInputError("Invalid "+label)
    return raw


def _allocation(raw):
    if raw is None:
        return None
    if not isinstance(raw,str) or not _ALLOCATION.fullmatch(raw):
        raise TradeInputError("Invalid maximum portfolio allocation")
    value=Decimal(raw)
    if not 0<value<=100:
        raise TradeInputError("Allocation percentage out of range")
    return str(value)


def _invalidation(raw):
    if raw is None:
        return None
    if not isinstance(raw,str) or not 1<=len(raw)<=1500 or not raw.strip():
        raise TradeInputError("Invalid thesis invalidation condition")
    return raw.strip()



def _price(raw):
    if raw is None or raw == "":
        return None
    if not isinstance(raw, str) or not _PRICE.fullmatch(raw):
        raise TradeInputError("Invalid plan price format")
    try:
        value=Decimal(raw)
    except InvalidOperation:
        raise TradeInputError("Invalid plan price") from None
    if not value.is_finite() or not 0 < value < _MAX_PRICE:
        raise TradeInputError("Invalid plan price range")
    return value


def normalize_plan(raw):
    if not isinstance(raw,dict) or frozenset(raw) not in (
        _BASE_FIELDS, _BASE_FIELDS|_EXTRA_FIELDS,
    ):
        raise TradeInputError("Invalid plan fields")
    try:
        key=str(UUID(raw["idempotencyKey"]))
    except (KeyError, ValueError, TypeError, AttributeError):
        raise TradeInputError("Invalid idempotency key") from None
    ticker=raw.get("ticker")
    if not isinstance(ticker,str) or not _TICKER.fullmatch(ticker):
        raise TradeInputError("Invalid ticker")
    target=_price(raw["targetPrice"])
    stop=_price(raw["stopPrice"])
    currency=raw.get("priceCurrency")
    if target is None and stop is None:
        if currency is not None:
            raise TradeInputError("Cleared plan must have no currency")
    elif not isinstance(currency,str) or not _CURRENCY.fullmatch(currency):
        raise TradeInputError("Invalid plan currency")
    reason=raw.get("rationale")
    if not isinstance(reason,str) or not 1<=len(reason)<=3000 or not reason.strip():
        raise TradeInputError("Plan revision needs an explanation")
    result={"idempotencyKey":key,"ticker":ticker,
            "targetPrice":str(target) if target is not None else None,
            "stopPrice":str(stop) if stop is not None else None,
            "priceCurrency":currency,"rationale":reason.strip()}
    if _EXTRA_FIELDS.issubset(raw):
        result.update({
            "strategyType":_enum(raw["strategyType"],_STRATEGIES,"strategy type"),
            "investmentHorizon":_enum(raw["investmentHorizon"],_HORIZONS,"horizon"),
            "invalidationCondition":_invalidation(raw["invalidationCondition"]),
            "maxAllocationPct":_allocation(raw["maxAllocationPct"]),
            "reviewCadence":_enum(raw["reviewCadence"],_CADENCES,"review cadence"),
        })
    # Do not add new NULL keys for historical six-field requests:
    # their persisted idempotency digest must remain stable after migration.
    return result


def _row(row):
    return {"id":str(row[0]),"ticker":row[1],
            "targetPrice":str(row[2]) if row[2] is not None else None,
            "stopPrice":str(row[3]) if row[3] is not None else None,
            "priceCurrency":row[4],"rationale":row[5],
            "createdAt":row[6].isoformat(),"provenance":"USER_AUTHORED",
            "strategyType":row[7],
            "investmentHorizon":row[8],
            "invalidationCondition":row[9],
            "maxAllocationPct":str(row[10]) if row[10] is not None else None,
            "reviewCadence":row[11],
            "isBrokerOrder":False}


def list_plans(identity_conn, trade_conn, subject):
    scope=_confirmed_scope(identity_conn,subject)
    with trade_conn.transaction():
        _runtime_safety(trade_conn)
        _tenant_scope(trade_conn,scope)
        rows=trade_conn.execute("""SELECT id,ticker,target_price,stop_price,
          price_currency,rationale,created_at,
          strategy_type,investment_horizon,invalidation_condition,
          max_allocation_pct,review_cadence
          FROM saas_journal_plan_revisions
          ORDER BY created_at DESC,id DESC LIMIT %s""",(_LIST_LIMIT,)).fetchall()
    return {"plans":[_row(row) for row in rows],"source":"USER_AUTHORED_ONLY",
            "limit":_LIST_LIMIT}


def create_plan(identity_conn,trade_conn,subject,raw):
    entry=normalize_plan(raw)
    scope=_confirmed_scope(identity_conn,subject)
    digest=sha256(json.dumps(entry,sort_keys=True,separators=(",",":")).encode()).hexdigest()
    with trade_conn.transaction():
        _runtime_safety(trade_conn)
        _tenant_scope(trade_conn,scope)
        row=trade_conn.execute("""SELECT id,request_hash
           FROM saas_journal_plan_revisions WHERE idempotency_key=%s""",
           (entry["idempotencyKey"],)).fetchone()
        if row:
            if row[1].strip()!=digest:
                raise TradeConflict("Plan revision idempotency mismatch")
            return {"id":str(row[0]),"replayed":True}
        inserted=trade_conn.execute("""INSERT INTO saas_journal_plan_revisions
          (workspace_id,author_user_id,idempotency_key,request_hash,ticker,
           target_price,stop_price,price_currency,rationale,
           strategy_type,investment_horizon,invalidation_condition,
           max_allocation_pct,review_cadence)
          VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
          ON CONFLICT(workspace_id,idempotency_key) DO NOTHING RETURNING id""",
          (scope["workspaceId"],scope["userId"],entry["idempotencyKey"],digest,
           entry["ticker"],entry["targetPrice"],entry["stopPrice"],
           entry["priceCurrency"],entry["rationale"],
           entry.get("strategyType"),entry.get("investmentHorizon"),
           entry.get("invalidationCondition"),entry.get("maxAllocationPct"),
           entry.get("reviewCadence"))).fetchone()
        if not inserted:
            old=trade_conn.execute("""SELECT id,request_hash
                 FROM saas_journal_plan_revisions WHERE idempotency_key=%s""",
                 (entry["idempotencyKey"],)).fetchone()
            if not old or old[1].strip()!=digest:
                raise TradeConflict("Concurrent plan idempotency mismatch")
            return {"id":str(old[0]),"replayed":True}
    return {"id":str(inserted[0]),"replayed":False}
