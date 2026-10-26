"""Immutable human-written TRADE_NOTE linked to ONE released broker execution.

Never constructs a broker fill, signs evidence, changes manual trade assertions,
or mutates existing journal notes. The read-only broker service must separately
prove a currently signed/latest approved source; SQL rechecks the version,
symbol and original release under tenant FORCE RLS before commit.
"""
from __future__ import annotations

from hashlib import sha256
import json
import re
from uuid import UUID

from services.saas_api.ledger_read import private_ledger
from services.saas_api.trades import (
    TradeInputError, TradeConflict, TradeNotFound,
    _confirmed_scope, _runtime_safety, _tenant_scope,
)

_SYMBOL = re.compile(r"^[A-Z0-9.:-]{1,32}$")
_KEY = re.compile(r"^[0-9a-f]{64}$")


def normalize_broker_note(raw):
    """No user-supplied author, workspace, publication, version or trade kind."""
    allowed={"idempotencyKey","ticker","content","accountId","sourceRef"}
    if not isinstance(raw,dict) or set(raw)!=allowed:
        raise TradeInputError("INVALID_BROKER_NOTE")
    try:
        idem=str(UUID(raw["idempotencyKey"]))
        account=str(UUID(raw["accountId"]))
    except (ValueError,AttributeError,TypeError):
        raise TradeInputError("INVALID_BROKER_NOTE") from None
    ticker=raw["ticker"]
    source=raw["sourceRef"]
    content=raw["content"]
    if (not isinstance(ticker,str) or not _SYMBOL.fullmatch(ticker)
            or not isinstance(source,str) or not _KEY.fullmatch(source)
            or not isinstance(content,str) or len(content)>6000
            or not content.strip()):
        raise TradeInputError("INVALID_BROKER_NOTE")
    return {"idempotencyKey":idem,"ticker":ticker,"content":content.strip(),
            "accountId":account,"sourceRef":source}


def _digest(entry):
    # The immutable source reference is part of the idempotency contract.
    return sha256(json.dumps(entry,sort_keys=True,separators=(",",":")).encode()).hexdigest()


def create_broker_note(identity, broker, trade, subject, raw):
    entry=normalize_broker_note(raw)
    scope=_confirmed_scope(identity,subject)
    # Live approval, independent signature, refreshed OAuth authorization, full
    # account evidence/version agreement are all required; no provider calls.
    current=private_ledger(identity,broker,subject)
    matched=next((f for f in current["executions"]
        if f["accountId"]==entry["accountId"]
        and f["sourceRef"]==entry["sourceRef"]
        and f["symbol"]==entry["ticker"]
        and f["provenance"]=="BROKER_VERIFIED"),None)
    if not current["readEnabled"] or matched is None:
        raise TradeNotFound("VERIFIED_FILL_NOT_AVAILABLE")

    digest=_digest(entry)
    with trade.transaction():
        _runtime_safety(trade)
        _tenant_scope(trade,scope)
        # Share P4's account-scoped transaction lock with independent release
        # and reconciliation writers. No new review can slip between the
        # final latest-version query and commit of this human-authored link.
        trade.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s,0))",
                      (scope["workspaceId"]+":"+entry["accountId"],))
        # Never convert one journal idempotency key into another claim.
        old=trade.execute("""SELECT j.id,j.request_hash,l.account_id,l.source_key_hmac
            FROM saas_journal_records j
            LEFT JOIN saas_journal_broker_fill_links l
              ON l.workspace_id=j.workspace_id AND l.journal_id=j.id
            WHERE j.workspace_id=%s AND j.idempotency_key=%s""",
            (scope["workspaceId"],entry["idempotencyKey"])).fetchone()
        if old:
            if (old[1].strip()!=digest or str(old[2])!=entry["accountId"]
                    or old[3]!=entry["sourceRef"]):
                raise TradeConflict("BROKER_NOTE_KEY_CONFLICT")
            return {"id":str(old[0]),"replayed":True,"source":"USER_AUTHORED"}

        # This note remains a genuine authored TRADE_NOTE, distinct from manual
        # saas_trade_events; a failed association rolls back the note insert.
        note=trade.execute("""INSERT INTO saas_journal_records
            (workspace_id,author_user_id,idempotency_key,request_hash,
             entry_kind,ticker,text_content,trade_event_id)
            VALUES (%s,%s,%s,%s,'TRADE_NOTE',%s,%s,NULL)
            ON CONFLICT (workspace_id,idempotency_key) DO NOTHING RETURNING id""",
            (scope["workspaceId"],scope["userId"],entry["idempotencyKey"],digest,
             entry["ticker"],entry["content"])).fetchone()
        if note is None:
            # Concurrent writer committed while we waited on the unique key.
            old=trade.execute("""SELECT j.id,j.request_hash,l.account_id,l.source_key_hmac
              FROM saas_journal_records j LEFT JOIN saas_journal_broker_fill_links l
                ON l.workspace_id=j.workspace_id AND l.journal_id=j.id
              WHERE j.workspace_id=%s AND j.idempotency_key=%s""",
              (scope["workspaceId"],entry["idempotencyKey"])).fetchone()
            if (not old or old[1].strip()!=digest or
                    str(old[2])!=entry["accountId"] or old[3]!=entry["sourceRef"]):
                raise TradeConflict("BROKER_NOTE_KEY_CONFLICT")
            return {"id":str(old[0]),"replayed":True,"source":"USER_AUTHORED"}

        # Independent database role cannot issue publications; source/version
        # are read from private released records, never accepted from a client.
        # The WHERE gate rejects any review superseded between proof and write.
        link=trade.execute("""INSERT INTO saas_journal_broker_fill_links
            (workspace_id,journal_id,author_user_id,ticker,account_id,
             publication_id,review_version_id,source_key_hmac)
            SELECT %s,%s,%s,%s,p.account_id,p.id,p.review_version_id,s.source_key_hmac
            FROM saas_broker_ledger_publications p
            JOIN saas_broker_ledger_sources s
              ON s.workspace_id=p.workspace_id AND s.publication_id=p.id
             AND s.account_id=p.account_id AND s.review_version_id=p.review_version_id
            JOIN saas_reconciliation_versions v
              ON v.workspace_id=p.workspace_id AND v.id=p.review_version_id
             AND v.account_id=p.account_id AND v.version_num=p.review_version_num
            JOIN saas_broker_accounts a
              ON a.workspace_id=p.workspace_id AND a.id=p.account_id
            JOIN saas_broker_connections c
              ON c.workspace_id=a.workspace_id AND c.id=a.connection_id
             AND c.provider_code='TIGER' AND c.status='CONNECTED'
             AND c.authorization_expires_at > now() + interval '60 seconds'
             AND cardinality(c.granted_scopes)>0
             AND NOT EXISTS (
               SELECT 1 FROM unnest(c.granted_scopes) scope(value)
               WHERE scope.value ~* '(trade|order|write|place|cancel|transfer|withdraw|modify|execute|admin)'
             )
            JOIN saas_verified_execution_stage f
              ON f.workspace_id=s.workspace_id AND f.version_id=s.review_version_id
             AND f.source_key_hmac=s.source_key_hmac
            WHERE p.workspace_id=%s AND p.account_id=%s
              AND s.source_key_hmac=%s AND f.symbol=%s
              AND v.state='STAGED' AND v.version_num=%s
              AND NOT EXISTS (
                SELECT 1 FROM saas_reconciliation_versions newer
                WHERE newer.workspace_id=v.workspace_id AND newer.account_id=v.account_id
                  AND newer.version_num>v.version_num
              )
            RETURNING journal_id""",
            (scope["workspaceId"],note[0],scope["userId"],entry["ticker"],
             scope["workspaceId"],entry["accountId"],entry["sourceRef"],entry["ticker"],
             matched["reviewVersion"])).fetchone()
        if not link:
            raise TradeNotFound("VERIFIED_FILL_CHANGED")
    return {"id":str(note[0]),"replayed":False,"source":"USER_AUTHORED"}
