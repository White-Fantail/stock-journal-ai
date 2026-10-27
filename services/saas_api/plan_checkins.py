"""Immutable, user-labeled plan adherence check-ins (not audited compliance).

A successful submission atomically appends an ordinary REVIEW journal note and
a structured self-assessment linked to the latest immutable plan revision.
No Tiger execution inference, market prices, notifications, account IDs or AI.
"""
from __future__ import annotations

from hashlib import sha256
import json
import re
from uuid import UUID

from services.saas_api.trades import (
    TradeInputError,TradeConflict,TradeNotFound,
    _confirmed_scope,_runtime_safety,_tenant_scope,
)
from services.saas_api.journal_plans import _row as _plan_row

_TICKER=re.compile(r"^[A-Z0-9.:-]{1,32}$")
_STATUSES=frozenset(("FOLLOWED","PARTIAL","DEVIATED","UNCERTAIN"))
_FIELDS=frozenset(("idempotencyKey","ticker","expectedPlanRevisionId",
                   "selfAssessment","content","nextAction"))


def _id(value,label):
    if not isinstance(value,str):
        raise TradeInputError("Invalid "+label)
    try:
        return str(UUID(value))
    except (TypeError,ValueError,AttributeError):
        raise TradeInputError("Invalid "+label) from None


def normalize_checkin(raw):
    if not isinstance(raw,dict) or frozenset(raw)!=_FIELDS:
        raise TradeInputError("Invalid review fields")
    key=_id(raw["idempotencyKey"],"idempotency key")
    plan_id=_id(raw["expectedPlanRevisionId"],"plan revision")
    ticker=raw["ticker"]
    if not isinstance(ticker,str) or not _TICKER.fullmatch(ticker):
        raise TradeInputError("Invalid ticker")
    status=raw["selfAssessment"]
    if not isinstance(status,str) or status not in _STATUSES:
        raise TradeInputError("Invalid self assessment")
    for name,limit in (("content",6000),("nextAction",1500)):
        text=raw[name]
        if not isinstance(text,str) or not 1<=len(text)<=limit or not text.strip():
            raise TradeInputError("Invalid review content")
    return {"idempotencyKey":key,"ticker":ticker,
            "expectedPlanRevisionId":plan_id,"selfAssessment":status,
            "content":raw["content"].strip(),"nextAction":raw["nextAction"].strip()}


_PLAN_SELECT="""SELECT id,ticker,target_price,stop_price,price_currency,
    rationale,created_at,strategy_type,investment_horizon,
    invalidation_condition,max_allocation_pct,review_cadence
    FROM saas_journal_plan_revisions
    WHERE workspace_id=%s AND ticker=%s
    ORDER BY created_at DESC,id DESC LIMIT 1"""


def context(identity,trade,subject,ticker):
    if not isinstance(ticker,str) or not _TICKER.fullmatch(ticker):
        raise TradeInputError("Invalid ticker")
    scope=_confirmed_scope(identity,subject)
    with trade.transaction():
        _runtime_safety(trade)
        _tenant_scope(trade,scope)
        current=trade.execute(_PLAN_SELECT,(scope["workspaceId"],ticker)).fetchone()
        # Checkin listing is independently capped and explicitly marked a sample.
        rows=trade.execute("""SELECT c.id,c.plan_revision_id,c.self_assessment,
                 c.next_action,c.created_at,j.text_content
            FROM saas_journal_plan_checkins c
            JOIN saas_journal_records j
              ON j.workspace_id=c.workspace_id AND j.id=c.journal_id
            WHERE c.workspace_id=%s AND c.ticker=%s
            ORDER BY c.created_at DESC,c.id DESC LIMIT 10""",
            (scope["workspaceId"],ticker)).fetchall()
    return {"ticker":ticker,
            "currentPlan":_plan_row(current) if current else None,
            "recent":[{"id":str(r[0]),"planRevisionId":str(r[1]),
                       "selfAssessment":r[2],"nextAction":r[3],
                       "createdAt":r[4].isoformat(),"content":r[5]}
                      for r in rows],
            "recentLimit":10,"source":"USER_SELF_ASSESSED_ONLY"}


def create_checkin(identity,trade,subject,raw):
    value=normalize_checkin(raw)
    scope=_confirmed_scope(identity,subject)
    digest=sha256(json.dumps(value,sort_keys=True,separators=(",",":")).encode()).hexdigest()
    wid,uid=scope["workspaceId"],scope["userId"]
    with trade.transaction():
        _runtime_safety(trade)
        _tenant_scope(trade,scope)
        old=trade.execute("""SELECT id,request_hash
            FROM saas_journal_plan_checkins
            WHERE workspace_id=%s AND idempotency_key=%s""",
            (wid,value["idempotencyKey"])).fetchone()
        if old:
            if old[1].strip()!=digest:
                raise TradeConflict("Self-assessment idempotency mismatch")
            return {"id":str(old[0]),"replayed":True,
                    "provenance":"USER_SELF_ASSESSED"}
        # Re-read the current plan inside the write transaction; the exact
        # version being assessed is retained even if later revisions are added.
        plan=trade.execute(_PLAN_SELECT,(wid,value["ticker"])).fetchone()
        if not plan:
            raise TradeNotFound("Investment plan not found")
        if str(plan[0])!=value["expectedPlanRevisionId"]:
            raise TradeConflict("Investment plan changed; review again")
        # The companion note is an actual user REVIEW so the legacy reminder
        # system registers the completed check-in without fabricated compliance.
        note=trade.execute("""INSERT INTO saas_journal_records
          (workspace_id,author_user_id,idempotency_key,request_hash,
           entry_kind,ticker,text_content)
          VALUES (%s,%s,%s,%s,'REVIEW',%s,%s) RETURNING id""",
          (wid,uid,value["idempotencyKey"],digest,value["ticker"],
           value["content"])).fetchone()
        check=trade.execute("""INSERT INTO saas_journal_plan_checkins
          (workspace_id,author_user_id,idempotency_key,request_hash,ticker,
           plan_revision_id,journal_id,self_assessment,next_action)
          VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
          (wid,uid,value["idempotencyKey"],digest,value["ticker"],
           plan[0],note[0],value["selfAssessment"],value["nextAction"])).fetchone()
    return {"id":str(check[0]),"replayed":False,
            "provenance":"USER_SELF_ASSESSED"}
