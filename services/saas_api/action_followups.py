"""Immutable owner-confirmed next-action states; never automated compliance."""
from __future__ import annotations
from hashlib import sha256
from uuid import UUID
import json
from services.saas_api.trades import (
 TradeInputError,TradeConflict,TradeNotFound,
 _confirmed_scope,_runtime_safety,_tenant_scope,
)
_STATUSES=frozenset(("DONE","NOT_DONE","NOT_APPLICABLE","UNCERTAIN"))
_FIELDS=frozenset(("idempotencyKey","checkinId","state","note"))
_LIMIT=100

def normalize_followup(raw):
 if not isinstance(raw,dict) or frozenset(raw)!=_FIELDS:
  raise TradeInputError("Invalid action follow-up fields")
 try:
  key=str(UUID(raw["idempotencyKey"]))
  checkin=str(UUID(raw["checkinId"]))
 except (ValueError,TypeError,KeyError,AttributeError):
  raise TradeInputError("Invalid action follow-up identifiers") from None
 state=raw["state"]
 note=raw["note"]
 if not isinstance(state,str) or state not in _STATUSES:
  raise TradeInputError("Invalid action follow-up status")
 if note is not None and (not isinstance(note,str) or not 1<=len(note.strip())<=1000):
  raise TradeInputError("Invalid action follow-up note")
 return {"idempotencyKey":key,"checkinId":checkin,"state":state,
         "note":note.strip() if note is not None else None}

def list_followups(identity,trade,subject):
 scope=_confirmed_scope(identity,subject)
 wid=scope["workspaceId"]
 with trade.transaction():
  _runtime_safety(trade);_tenant_scope(trade,scope)
  # Latest user self-review for EACH ticker, independent of limited 10-row
  # checkin/context or 200-row journal UI feeds. EVENT_DRIVEN included.
  rows=trade.execute("""SELECT c.id,c.ticker,c.next_action,c.created_at,
      c.self_assessment,f.state,f.note,f.created_at
    FROM (
      SELECT DISTINCT ON(ticker) id,ticker,next_action,created_at,self_assessment
      FROM saas_journal_plan_checkins WHERE workspace_id=%s
      ORDER BY ticker,created_at DESC,id DESC LIMIT %s
    ) c LEFT JOIN LATERAL (
      SELECT state,note,created_at FROM saas_review_action_followups
      WHERE workspace_id=%s AND checkin_id=c.id
      ORDER BY created_at DESC,id DESC LIMIT 1
    ) f ON true ORDER BY c.ticker""",(wid,_LIMIT+1,wid)).fetchall()
 if len(rows)>_LIMIT:
  raise TradeConflict("Too many user review actions for complete list")
 return {"source":"USER_REPORTED_ACTION_ONLY","complete":True,
   "items":[{"checkinId":str(r[0]),"ticker":r[1],"nextAction":r[2],
    "selfAssessment":r[4],"checkinAt":r[3].isoformat(),"state":r[5],
    "note":r[6],"resolvedAt":r[7].isoformat() if r[7] else None}
    for r in rows]}

def create_followup(identity,trade,subject,raw):
 value=normalize_followup(raw)
 scope=_confirmed_scope(identity,subject)
 wid,uid=scope["workspaceId"],scope["userId"]
 digest=sha256(json.dumps(value,sort_keys=True,separators=(",",":")).encode()).hexdigest()
 with trade.transaction():
  _runtime_safety(trade);_tenant_scope(trade,scope)
  previous=trade.execute("""SELECT id,request_hash FROM saas_review_action_followups
    WHERE workspace_id=%s AND idempotency_key=%s""",
    (wid,value["idempotencyKey"])).fetchone()
  if previous:
   if previous[1].strip()!=digest:
    raise TradeConflict("Action follow-up idempotency conflict")
   return {"id":str(previous[0]),"replayed":True,"source":"USER_REPORTED_ACTION_ONLY"}
  row=trade.execute("""SELECT c.ticker FROM saas_journal_plan_checkins c
    WHERE c.workspace_id=%s AND c.id=%s""",(wid,value["checkinId"])).fetchone()
  if not row:
   raise TradeNotFound("Self-reviewed next action not found in owner workspace")
  # Never revise a superseded action when a newer self review already exists.
  current=trade.execute("""SELECT id FROM saas_journal_plan_checkins
    WHERE workspace_id=%s AND ticker=%s ORDER BY created_at DESC,id DESC LIMIT 1""",
    (wid,row[0])).fetchone()
  if not current or str(current[0])!=value["checkinId"]:
   raise TradeConflict("Newer self-review exists; refresh before follow-up")
  saved=trade.execute("""INSERT INTO saas_review_action_followups
    (workspace_id,author_user_id,idempotency_key,request_hash,checkin_id,state,note)
    VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
    (wid,uid,value["idempotencyKey"],digest,value["checkinId"],
     value["state"],value["note"])).fetchone()
 return {"id":str(saved[0]),"replayed":False,"source":"USER_REPORTED_ACTION_ONLY"}
