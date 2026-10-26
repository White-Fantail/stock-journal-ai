"""P5 user-invoked AI quota claim. No AI prompts, notes or output persisted.

This endpoint is metadata-only. It never calls a model or releases financial
data; Vercel performs a separate explicit-consent request after a successful
scoped, atomic claim. Claims are charged even if the provider later fails.
"""
from __future__ import annotations
from datetime import datetime, timezone
from services.saas_api.trades import _confirmed_scope, _runtime_safety, _tenant_scope, TradeInputError, TradeConflict

LIMIT_DAY=4
LIMIT_MONTH=60

def claim_ai(identity, trade, subject, payload):
    if (not isinstance(payload,dict) or set(payload)!={"mode","consented"}
            or payload["consented"] is not True
            or payload["mode"] not in ("STOCK_REVIEW","HABITS")):
        raise TradeInputError("AI_CONSENT_REQUIRED")
    scope=_confirmed_scope(identity,subject)
    now=datetime.now(timezone.utc)
    month=now.date().replace(day=1)
    with trade.transaction():
        _runtime_safety(trade)
        _tenant_scope(trade,scope)
        # Serialize the two bucket updates on a single workspace, so a failing
        # monthly claim rolls back the daily claim as well.
        trade.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s,0))",
                      (scope["workspaceId"]+":AI_QUOTA",))
        remaining={}
        for label, start, limit in (("DAY",now.date(),LIMIT_DAY),
                                    ("MONTH",month,LIMIT_MONTH)):
            row=trade.execute("""INSERT INTO saas_ai_request_quotas
                (workspace_id,period_type,period_start,request_count)
                VALUES (%s,%s,%s,1)
                ON CONFLICT (workspace_id,period_type,period_start)
                DO UPDATE SET request_count=saas_ai_request_quotas.request_count+1,
                    last_requested_at=now()
                WHERE saas_ai_request_quotas.request_count<%s
                RETURNING request_count""",
                (scope["workspaceId"],label,start,limit)).fetchone()
            if not row:
                raise TradeConflict("AI_QUOTA_EXCEEDED")
            remaining[label]=limit-int(row[0])
    return {"claimed":True,"remainingDay":remaining["DAY"],
            "remainingMonth":remaining["MONTH"]}
