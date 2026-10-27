"""Versioned investor-authored principles; no inferred financial suitability."""
from __future__ import annotations
from hashlib import sha256
from decimal import Decimal
import json
import re
from uuid import UUID
from services.saas_api.trades import (
    TradeInputError, TradeConflict, _confirmed_scope, _runtime_safety, _tenant_scope,
)

_FIELDS = frozenset(("idempotencyKey","objective","horizon","baseCurrency",
                     "maxSinglePct","riskLimitPct","reviewCadence","note"))
_OPTIONS = {
    "objective": {"GROWTH","INCOME","PRESERVATION","LEARNING","OTHER"},
    "horizon": {"UNDER_3_YEARS","THREE_TO_TEN_YEARS","OVER_TEN_YEARS","UNDECIDED"},
    "reviewCadence": {"MONTHLY","QUARTERLY","SEMIANNUAL","ANNUAL"},
}
_PERCENT = re.compile(r"^(?:0|[1-9][0-9]?|100)(?:\.[0-9]{1,2})?$")

def normalize_principles(raw):
    if not isinstance(raw, dict) or set(raw) != _FIELDS:
        raise TradeInputError("Invalid investor principles fields")
    try:
        key=str(UUID(raw["idempotencyKey"]))
    except (KeyError,TypeError,ValueError,AttributeError):
        raise TradeInputError("Invalid idempotency key") from None
    value={"idempotencyKey":key}
    for field, allowed in _OPTIONS.items():
        v=raw[field]
        if v is not None and (not isinstance(v,str) or v not in allowed):
            raise TradeInputError("Invalid personal principle option")
        value[field]=v
    currency=raw["baseCurrency"]
    if currency is not None and (not isinstance(currency,str) or
            not re.fullmatch(r"[A-Z]{3}",currency)):
        raise TradeInputError("Invalid display currency")
    value["baseCurrency"]=currency
    for field in ("maxSinglePct","riskLimitPct"):
        v=raw[field]
        if v is not None and (not isinstance(v,str) or not _PERCENT.fullmatch(v) or
                             not (Decimal("0") < Decimal(v) <= Decimal("100"))):
            raise TradeInputError("Invalid self-authored percentage")
        value[field]=str(Decimal(v)) if v is not None else None
    note=raw["note"]
    if note is not None and (not isinstance(note,str) or not 1<=len(note.strip())<=1500):
        raise TradeInputError("Invalid notes")
    value["note"]=note.strip() if note is not None else None
    return value

def _row(row):
    if row is None:return None
    return {
      "id":str(row[0]),"objective":row[1],"horizon":row[2],"baseCurrency":row[3],
      "maxSinglePct":str(row[4]) if row[4] is not None else None,
      "riskLimitPct":str(row[5]) if row[5] is not None else None,
      "reviewCadence":row[6],"note":row[7],"createdAt":row[8].isoformat(),
      "source":"USER_AUTHORED_ONLY",
    }

def get_principles(identity,trade,subject):
    scope=_confirmed_scope(identity,subject)
    with trade.transaction():
        _runtime_safety(trade);_tenant_scope(trade,scope)
        row=trade.execute("""SELECT id,objective,horizon,base_currency,max_single_pct,
          risk_limit_pct,review_cadence,note,created_at
          FROM saas_investor_principle_revisions WHERE workspace_id=%s
          ORDER BY created_at DESC,id DESC LIMIT 1""",(scope["workspaceId"],)).fetchone()
    return {"source":"USER_AUTHORED_ONLY","current":_row(row),"complete":True}

def save_principles(identity,trade,subject,raw):
    value=normalize_principles(raw)
    scope=_confirmed_scope(identity,subject)
    digest=sha256(json.dumps(value,sort_keys=True,separators=(",",":")).encode()).hexdigest()
    with trade.transaction():
        _runtime_safety(trade);_tenant_scope(trade,scope)
        previous=trade.execute("""SELECT id,request_hash FROM saas_investor_principle_revisions
          WHERE workspace_id=%s AND idempotency_key=%s""",
          (scope["workspaceId"],value["idempotencyKey"])).fetchone()
        if previous:
            if previous[1].strip()!=digest:
                raise TradeConflict("Investor principle replay mismatch")
            return {"id":str(previous[0]),"replayed":True,"source":"USER_AUTHORED_ONLY"}
        row=trade.execute("""INSERT INTO saas_investor_principle_revisions
          (workspace_id,author_user_id,idempotency_key,request_hash,objective,horizon,
          base_currency,max_single_pct,risk_limit_pct,review_cadence,note)
          VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
          (scope["workspaceId"],scope["userId"],value["idempotencyKey"],digest,
           value["objective"],value["horizon"],value["baseCurrency"],
           value["maxSinglePct"],value["riskLimitPct"],value["reviewCadence"],
           value["note"])).fetchone()
    return {"id":str(row[0]),"replayed":False,"source":"USER_AUTHORED_ONLY"}
