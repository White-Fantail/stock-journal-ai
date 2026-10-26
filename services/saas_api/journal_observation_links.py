"""Owner-only, append-only investment rationale for observed Tiger order or fill.

NOT an attested broker fill, a FIFO ledger, or a trade order. The external
observation reference is recomputed from encrypted tenant-scoped Tiger source
records using the restricted broker DB role before the authored note is saved.
"""
from __future__ import annotations

import hashlib
import json
import re
from uuid import UUID

from services.saas_api.trades import (
    TradeInputError, TradeNotFound, TradeConflict,
    _confirmed_scope, _runtime_safety, _tenant_scope,
)
from services.saas_api.tiger_oauth import _scope
# Import the optional owner pilot ONLY when this endpoint is called. The
# standard SaaS image deliberately excludes temporary/tiger_personal.
def owner_only(subject):
    from temporary.tiger_personal.api import owner_only as verify
    return verify(subject)


def load_orders(*args, **kwargs):
    from temporary.tiger_personal.history import load_orders as read
    return read(*args, **kwargs)


def load_probes(*args, **kwargs):
    from temporary.tiger_personal.fill_probe import load_probes as read
    return read(*args, **kwargs)

_TICKER=re.compile(r"^[A-Z0-9.:-]{1,32}$")
_SOURCE=re.compile(r"^[0-9a-f]{64}$")


def normalize_observation_note(raw):
    expected={"idempotencyKey","ticker","content","sourceRef","observationKind","page"}
    if not isinstance(raw,dict) or set(raw)!=expected:
        raise TradeInputError("INVALID_OBSERVATION_NOTE")
    try:
        key=str(UUID(raw["idempotencyKey"]))
    except (ValueError,TypeError,AttributeError):
        raise TradeInputError("INVALID_OBSERVATION_NOTE") from None
    ticker,source,kind=raw["ticker"],raw["sourceRef"],raw["observationKind"]
    page=raw["page"]
    content=raw["content"]
    if (not isinstance(ticker,str) or not _TICKER.fullmatch(ticker)
            or not isinstance(source,str) or not _SOURCE.fullmatch(source)
            or kind not in ("ORDER","FILL") or type(page) is not int
            or not 0<=page<=20 or (kind=="FILL" and page!=0)
            or not isinstance(content,str) or not content.strip()
            or len(content)>6000):
        raise TradeInputError("INVALID_OBSERVATION_NOTE")
    return {"idempotencyKey":key,"ticker":ticker,
            "sourceRef":source,"observationKind":kind,
            "page":page,"content":content.strip()}


def _lookup(identity,broker,subject,entry,workspace):
    """No caller-supplied account/tenant; accept only actual visible references."""
    owner_only(subject)
    with broker.transaction():
        wid=_scope(identity,broker,subject)
        if wid!=workspace:
            raise TradeNotFound("MISMATCHED_WORKSPACE")
        accounts=broker.execute("""SELECT a.id
          FROM saas_broker_accounts a
          JOIN saas_broker_connections c ON c.workspace_id=a.workspace_id
            AND c.id=a.connection_id
          WHERE a.workspace_id=%s AND c.provider_code='TIGER'
            AND c.auth_mode='SIGNATURE' AND c.status='PENDING_AUTH'
          ORDER BY a.created_at LIMIT 5""",(wid,)).fetchall()
        matched=[]
        for (aid,) in accounts:
            if entry["observationKind"]=="ORDER":
                source=load_orders(broker,wid,aid,page=entry["page"])["orders"]
            else:
                source=load_probes(broker,wid,aid)["fillObservations"]
            for row in source:
                if row["sourceRef"]==entry["sourceRef"] and row["symbol"]==entry["ticker"]:
                    matched.append(str(aid))
        if len(matched)!=1:
            raise TradeNotFound("OBSERVATION_NOT_AVAILABLE")
        return matched[0]


def create_observation_note(identity,broker,trade,subject,raw):
    entry=normalize_observation_note(raw)
    scope=_confirmed_scope(identity,subject)
    account=_lookup(identity,broker,subject,entry,scope["workspaceId"])
    digest=hashlib.sha256(json.dumps(entry,sort_keys=True,separators=(",",":")).encode()).hexdigest()
    with trade.transaction():
        _runtime_safety(trade)
        _tenant_scope(trade,scope)
        # Per-user authored idempotency key cannot be reused for another source.
        old=trade.execute("""SELECT j.id,j.request_hash,l.account_id,
                l.source_ref,l.observation_kind
          FROM saas_journal_records j
          LEFT JOIN saas_journal_tiger_observation_links l
            ON l.workspace_id=j.workspace_id AND l.journal_id=j.id
          WHERE j.workspace_id=%s AND j.idempotency_key=%s""",
          (scope["workspaceId"],entry["idempotencyKey"])).fetchone()
        if old:
            if (old[1].strip()!=digest or str(old[2])!=account
                    or old[3]!=entry["sourceRef"] or old[4]!=entry["observationKind"]):
                raise TradeConflict("OBSERVATION_NOTE_KEY_CONFLICT")
            return {"id":str(old[0]),"replayed":True,"source":"USER_AUTHORED"}
        created=trade.execute("""INSERT INTO saas_journal_records
          (workspace_id,author_user_id,idempotency_key,request_hash,
           entry_kind,ticker,text_content,trade_event_id)
          VALUES (%s,%s,%s,%s,'TRADE_NOTE',%s,%s,NULL)
          ON CONFLICT (workspace_id,idempotency_key) DO NOTHING RETURNING id""",
          (scope["workspaceId"],scope["userId"],entry["idempotencyKey"],digest,
           entry["ticker"],entry["content"])).fetchone()
        if not created:
            old=trade.execute("""SELECT j.id,j.request_hash,l.account_id,
                l.source_ref,l.observation_kind
              FROM saas_journal_records j
              LEFT JOIN saas_journal_tiger_observation_links l
                ON l.workspace_id=j.workspace_id AND l.journal_id=j.id
              WHERE j.workspace_id=%s AND j.idempotency_key=%s""",
              (scope["workspaceId"],entry["idempotencyKey"])).fetchone()
            if (not old or old[1].strip()!=digest or str(old[2])!=account
                    or old[3]!=entry["sourceRef"] or old[4]!=entry["observationKind"]):
                raise TradeConflict("OBSERVATION_NOTE_KEY_CONFLICT")
            return {"id":str(old[0]),"replayed":True,"source":"USER_AUTHORED"}
        trade.execute("""INSERT INTO saas_journal_tiger_observation_links
          (workspace_id,journal_id,author_user_id,ticker,account_id,
           source_ref,observation_kind)
          VALUES (%s,%s,%s,%s,%s,%s,%s)""",
          (scope["workspaceId"],created[0],scope["userId"],entry["ticker"],
           account,entry["sourceRef"],entry["observationKind"]))
    return {"id":str(created[0]),"replayed":False,"source":"USER_AUTHORED"}
