"""S2 manual fills: explicit user assertions, immutable and tenant-bound.

No direct trading, broker credentials, computed P&L or automatic publication.
Only authenticated server-side gateway callers can request reads/writes.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from hashlib import sha256
import json
import re
from typing import Any
from uuid import UUID

from services.saas_api.identity import resolve

_SYMBOL = re.compile(r"^[A-Z0-9.:-]{1,32}$")
_CURRENCY = re.compile(r"^[A-Z]{3}$")


class TradeInputError(ValueError):
    pass


class TradeConflict(Exception):
    pass


class TradeNotFound(Exception):
    pass


def _uuid(raw: Any, label: str) -> UUID:
    if not isinstance(raw, str):
        raise TradeInputError(f"Invalid {label}")
    try:
        return UUID(raw)
    except (ValueError, AttributeError) as exc:
        raise TradeInputError(f"Invalid {label}") from exc


def _amount(raw: Any, name: str, *, positive: bool) -> Decimal:
    if not isinstance(raw, str) or not re.fullmatch(r"\d{1,18}(?:\.\d{1,12})?", raw):
        raise TradeInputError(f"Invalid {name}")
    try:
        value = Decimal(raw)
    except InvalidOperation as exc:
        raise TradeInputError(f"Invalid {name}") from exc
    if (positive and value <= 0) or (not positive and value < 0):
        raise TradeInputError(f"Out-of-range {name}")
    return value


def normalize_trade(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise TradeInputError("Invalid trade payload")
    # Forbid aliases that would let a client claim another user/tenant/account.
    allowed = {"idempotencyKey", "kind", "confirm", "ticker", "side", "quantity",
               "price", "currency", "fee", "executedAt", "rationale", "voidsEventId"}
    if set(raw) - allowed:
        raise TradeInputError("Unexpected trade fields")
    if raw.get("confirm") is not True:
        raise TradeInputError("Explicit completed trade confirmation required")
    event_key = _uuid(raw.get("idempotencyKey"), "idempotency key")
    kind = raw.get("kind")
    if kind not in ("EXECUTION", "VOID"):
        raise TradeInputError("Invalid event kind")
    rationale = raw.get("rationale", "")
    if not isinstance(rationale, str) or len(rationale) > 3000:
        raise TradeInputError("Invalid rationale")
    rationale = rationale.strip() or None
    if kind == "VOID":
        if set(raw) - {"idempotencyKey", "kind", "confirm", "voidsEventId", "rationale"}:
            raise TradeInputError("Void cannot carry execution values")
        target = _uuid(raw.get("voidsEventId"), "void target")
        if not rationale:
            raise TradeInputError("Reason for correction is required")
        return {"idempotencyKey": str(event_key), "kind": "VOID",
                "voidsEventId": str(target), "rationale": rationale}

    if set(raw) - {"idempotencyKey", "kind", "confirm", "ticker", "side",
                   "quantity", "price", "currency", "fee", "executedAt", "rationale"}:
        raise TradeInputError("Execution cannot void another event")
    symbol = raw.get("ticker")
    if not isinstance(symbol, str) or not _SYMBOL.fullmatch(symbol):
        raise TradeInputError("Invalid uppercase symbol")
    side = raw.get("side")
    if side not in ("BUY", "SELL"):
        raise TradeInputError("Invalid side")
    currency = raw.get("currency")
    if not isinstance(currency, str) or not _CURRENCY.fullmatch(currency):
        raise TradeInputError("Invalid currency")
    quantity = _amount(raw.get("quantity"), "quantity", positive=True)
    price = _amount(raw.get("price"), "price", positive=True)
    fee = _amount(raw["fee"], "fee", positive=False) if raw.get("fee") not in ("", None) else None
    timestamp = raw.get("executedAt")
    if not isinstance(timestamp, str) or not 19 <= len(timestamp) <= 48:
        raise TradeInputError("Timezone-qualified execution time required")
    try:
        dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError as exc:
        raise TradeInputError("Invalid execution timestamp") from exc
    if dt.tzinfo is None or dt.utcoffset() is None:
        raise TradeInputError("Execution time requires timezone offset")
    if not 2000 <= dt.year <= 2100:
        raise TradeInputError("Execution date out of range")
    return {"idempotencyKey": str(event_key), "kind": "EXECUTION",
            "ticker": symbol, "side": side, "quantity": str(quantity),
            "price": str(price), "currency": currency,
            "fee": str(fee) if fee is not None else None,
            "executedAt": dt.isoformat(), "rationale": rationale}


def _digest(normalized: dict[str, Any]) -> str:
    return sha256(json.dumps(normalized, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _runtime_safety(conn) -> None:
    # A platform superuser / schema owner could bypass RLS. Deny those roles
    # even if someone accidentally supplied the identity admin DATABASE_URL.
    row = conn.execute("""
        SELECT rolsuper, rolbypassrls,
               pg_has_role(current_user, 'saas_trade_runtime', 'USAGE'),
               has_table_privilege(current_user,'saas_trade_events','INSERT'),
               has_table_privilege(current_user,'saas_trade_events','UPDATE'),
               has_table_privilege(current_user,'saas_trade_events','DELETE')
        FROM pg_roles WHERE rolname = current_user
    """).fetchone()
    if not row or row != (False, False, True, True, False, False):
        raise PermissionError("Dedicated least-privilege trade DB role required")


def _tenant_scope(conn, scope: dict[str, str]) -> None:
    conn.execute("SELECT set_config('saas.workspace_id',%s,true)", (scope["workspaceId"],))
    conn.execute("SELECT set_config('saas.user_id',%s,true)", (scope["userId"],))


def _confirmed_scope(identity_conn, subject: str) -> dict[str, str]:
    # DB lookup is REQUIRED on every request; never use a supplied workspace ID.
    found = resolve(identity_conn, subject)
    if found is None or found["role"] != "OWNER":
        raise TradeNotFound("No active membership")
    return found


def _as_json(record) -> dict[str, Any]:
    return {"id": str(record[0]), "kind": record[1], "voidsEventId": str(record[2]) if record[2] else None,
            "ticker": record[3], "side": record[4],
            "quantity": str(record[5]) if record[5] is not None else None,
            "price": str(record[6]) if record[6] is not None else None,
            "currency": record[7].strip() if record[7] else None,
            "fee": str(record[8]) if record[8] is not None else None,
            "executedAt": record[9].isoformat() if record[9] else None,
            "rationale": record[10], "provenance": record[11],
            "createdAt": record[12].isoformat()}


_FIELDS = """id,event_kind,voids_event_id,ticker,side,quantity,price,
            currency,fee,executed_at,rationale,provenance,created_at"""


def list_trades(identity_conn, trade_conn, subject: str) -> dict[str, Any]:
    scope = _confirmed_scope(identity_conn, subject)
    with trade_conn.transaction():
        _runtime_safety(trade_conn)
        _tenant_scope(trade_conn, scope)
        records = trade_conn.execute(
            f"SELECT {_FIELDS} FROM saas_trade_events ORDER BY created_at DESC, id DESC LIMIT 50"
        ).fetchall()
    return {"events": [_as_json(r) for r in records], "asOf": datetime.now(timezone.utc).isoformat(),
            "source": "USER_ASSERTED_ONLY", "limit": 50}


def create_trade(identity_conn, trade_conn, subject: str, payload: Any) -> dict[str, Any]:
    normalized = normalize_trade(payload)
    digest = _digest(normalized)
    scope = _confirmed_scope(identity_conn, subject)
    with trade_conn.transaction():
        _runtime_safety(trade_conn)
        _tenant_scope(trade_conn, scope)
        key = normalized["idempotencyKey"]
        old = trade_conn.execute(
            "SELECT id,request_hash FROM saas_trade_events WHERE idempotency_key=%s",
            (key,)
        ).fetchone()
        if old:
            if old[1].strip() != digest:
                raise TradeConflict("Idempotency key reused with another payload")
            return {"id": str(old[0]), "replayed": True, "source": "USER_ASSERTED"}
        kind = normalized["kind"]
        if kind == "VOID":
            target = trade_conn.execute(
                """SELECT event_kind FROM saas_trade_events WHERE id=%s""",
                (normalized["voidsEventId"],)
            ).fetchone()
            if not target or target[0] != "EXECUTION":
                raise TradeNotFound("Execution to void not found in authorized workspace")
            exists = trade_conn.execute(
                "SELECT 1 FROM saas_trade_events WHERE voids_event_id=%s",
                (normalized["voidsEventId"],)
            ).fetchone()
            if exists:
                raise TradeConflict("Execution has already been voided")
        sql = """INSERT INTO saas_trade_events
            (workspace_id,author_user_id,idempotency_key,request_hash,
             event_kind,voids_event_id,ticker,side,quantity,price,currency,fee,
             executed_at,executed_at_source,rationale)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (workspace_id,idempotency_key) DO NOTHING RETURNING id"""
        row = trade_conn.execute(sql, (
            scope["workspaceId"], scope["userId"], key, digest, kind,
            normalized.get("voidsEventId"), normalized.get("ticker"),
            normalized.get("side"), normalized.get("quantity"), normalized.get("price"),
            normalized.get("currency"), normalized.get("fee"), normalized.get("executedAt"),
            normalized.get("executedAt"), normalized.get("rationale")
        )).fetchone()
        if not row:
            # Concurrent identical idempotency request: return only if content
            # matches. Do not silently map a changed submission to old data.
            old = trade_conn.execute(
                "SELECT id,request_hash FROM saas_trade_events WHERE idempotency_key=%s",
                (key,)
            ).fetchone()
            if not old or old[1].strip() != digest:
                raise TradeConflict("Idempotency request mismatch")
            return {"id": str(old[0]), "replayed": True, "source": "USER_ASSERTED"}
        return {"id": str(row[0]), "replayed": False, "source": "USER_ASSERTED"}
