"""Owner-authored risk factor classifications; no inferred sector, correlation or order."""
from __future__ import annotations
from hashlib import sha256
import json,re
from uuid import UUID
from services.saas_api.trades import (
  TradeInputError,TradeConflict,_confirmed_scope,_runtime_safety,_tenant_scope,
)
_FACTORS=frozenset(("AI_INFRA","HIGH_GROWTH","US_TECH","CONSUMER_CYCLICAL",
                     "SPACE_DEFENSE","INTEREST_RATE","CHINA","OTHER"))
_SYMBOL=re.compile(r"^[A-Z0-9.:-]{1,32}$")
_LIMIT=100

def normalize_risk_factors(raw):
 if not isinstance(raw,dict) or set(raw)!={"idempotencyKey","ticker","factors","rationale"}:
  raise TradeInputError("Risk group fields invalid")
 try:key=str(UUID(raw["idempotencyKey"]))
 except (ValueError,TypeError,AttributeError):
  raise TradeInputError("Risk group idempotency invalid") from None
 ticker=raw["ticker"]
 factors=raw["factors"]
 reason=raw["rationale"]
 if not isinstance(ticker,str) or not _SYMBOL.fullmatch(ticker):
  raise TradeInputError("Risk group ticker invalid")
 if (not isinstance(factors,list) or len(factors)>3
   or any(not isinstance(f,str) or f not in _FACTORS for f in factors)
   or len(factors)!=len(set(factors))):
  raise TradeInputError("Risk group factors invalid")
 if not isinstance(reason,str) or not 1<=len(reason.strip())<=1500:
  raise TradeInputError("Risk group rationale invalid")
 return {"idempotencyKey":key,"ticker":ticker,
         "factors":sorted(factors),"rationale":reason.strip()}

def list_risk_factors(identity,trade,subject):
 scope=_confirmed_scope(identity,subject)
 with trade.transaction():
  _runtime_safety(trade);_tenant_scope(trade,scope)
  rows=trade.execute("""SELECT DISTINCT ON(ticker) id,ticker,factors,rationale,created_at
      FROM saas_risk_factor_revisions WHERE workspace_id=%s
      ORDER BY ticker,created_at DESC,id DESC LIMIT %s""",
      (scope["workspaceId"],_LIMIT+1)).fetchall()
 if len(rows)>_LIMIT:
  raise TradeConflict("Risk factors above complete safe bound")
 return {"source":"USER_CLASSIFIED_ONLY","complete":True,
         "riskFactors":[{"id":str(r[0]),"ticker":r[1],"factors":r[2],
                          "rationale":r[3],"createdAt":r[4].isoformat()}
                         for r in rows]}

def save_risk_factors(identity,trade,subject,raw):
 value=normalize_risk_factors(raw)
 scope=_confirmed_scope(identity,subject)
 digest=sha256(json.dumps(value,sort_keys=True,separators=(",",":")).encode()).hexdigest()
 with trade.transaction():
  _runtime_safety(trade);_tenant_scope(trade,scope)
  previous=trade.execute("""SELECT id,request_hash FROM saas_risk_factor_revisions
      WHERE workspace_id=%s AND idempotency_key=%s""",
      (scope["workspaceId"],value["idempotencyKey"])).fetchone()
  if previous:
   if previous[1].strip()!=digest:raise TradeConflict("Risk group idempotency mismatch")
   return {"id":str(previous[0]),"replayed":True,"source":"USER_CLASSIFIED_ONLY"}
  item=trade.execute("""INSERT INTO saas_risk_factor_revisions
      (workspace_id,author_user_id,idempotency_key,request_hash,ticker,factors,rationale)
      VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
      (scope["workspaceId"],scope["userId"],value["idempotencyKey"],digest,
       value["ticker"],value["factors"],value["rationale"])).fetchone()
 return {"id":str(item[0]),"replayed":False,"source":"USER_CLASSIFIED_ONLY"}
