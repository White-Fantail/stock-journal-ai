"""P4 append-only reconciliation journal and staged account ledger.

Not an HTTP route and not a provider certificate issuer. Only a separate,
approved read-only source verifier can produce a valid attestation. A browser,
broker cursor, synthetic backfill or a successful FIFO result alone cannot
authorize staging. No holdings or P/L is published by this module.
"""
from __future__ import annotations

from datetime import timezone
from decimal import Decimal
import hashlib
import hmac
import json
import os
import re
from uuid import UUID

from services.broker_connectors.backfill import source_key
from services.broker_connectors.fifo_projection import VerifiedExecution
from services.broker_connectors.reconciliation import AccountEvidence, reconcile
from services.saas_api.backfill_worker import _account_authorized
from services.saas_api.tiger_oauth import _scope

_HEX = re.compile(r"^[0-9a-f]{64}$")
_NUMERIC_MAX_DIGITS = 24
_NUMERIC_SCALE = 12


class AuditRefused(RuntimeError):
    """Only sanitized refusal codes are ever exposed to callers."""


def _secret(name):
    raw=os.environ.get(name,"")
    if not _HEX.fullmatch(raw):
        raise AuditRefused("KEY_NOT_CONFIGURED")
    return bytes.fromhex(raw)


def _number(value, *, signed=False):
    """Validate exact PostgreSQL numeric(36,12) storage; never round."""
    if not isinstance(value,Decimal) or not value.is_finite() or (
        not signed and value<0):
        raise AuditRefused("NUMERIC_NOT_REPRESENTABLE")
    # Compare before formatting: avoid huge exponent/integer expansion.
    if value != value.quantize(Decimal("0.000000000001")):
        raise AuditRefused("NUMERIC_NOT_REPRESENTABLE")
    if value.copy_abs() >= Decimal("1e24"):
        raise AuditRefused("NUMERIC_NOT_REPRESENTABLE")
    return value


def _input_digest(account: AccountEvidence, secret: bytes):
    """Account-bound HMAC of ALL inputs; raw IDs are never persisted/logged."""
    try:
        data={
            "v":1,"workspace":str(account.workspace_id),"account":str(account.account_id),
            "start":account.start.astimezone(timezone.utc).isoformat(),
            "end":account.end.astimezone(timezone.utc).isoformat(),
            "windows":[(w.start.astimezone(timezone.utc).isoformat(),
                        w.end.astimezone(timezone.utc).isoformat(),w.provider_certified)
                       for w in account.windows],
            "executions":[(f.source_id,f.symbol,f.side,str(f.quantity),str(f.price),
                           f.currency,f.occurred_at.astimezone(timezone.utc).isoformat()
                           if f.occurred_at.tzinfo is not None else "UNVERIFIED",
                           str(f.fee) if f.fee is not None else None,f.fee_currency)
                          for f in account.executions],
            "snapshot":(account.snapshot.as_of.astimezone(timezone.utc).isoformat(),
                        account.snapshot.provider_verified,
                        [(p.symbol,str(p.quantity),p.currency) for p in account.snapshot.positions])
                       if account.snapshot is not None else None,
            "orders":account.orders_reconciled,
            "cash":account.cash_activity_reconciled,
            "corporate":account.corporate_actions_reconciled,
        }
        canonical=json.dumps(data,sort_keys=True,separators=(",",":"),ensure_ascii=True,allow_nan=False).encode()
        if len(canonical)>1500000:
            raise AuditRefused("SOURCE_TOO_LARGE")
        return hmac.new(secret,canonical,hashlib.sha256).hexdigest()
    except (AttributeError,TypeError,ValueError,OverflowError):
        raise AuditRefused("SOURCE_CONTRACT_INVALID") from None


def _attested(digest, signature):
    """Verify independently issued opaque attestation; never issue it here."""
    if (os.environ.get("TIGER_PARTNER_OAUTH_APPROVED")!="1"
            or os.environ.get("TIGER_READ_ONLY_GRANT_VERIFIED")!="1"
            or not isinstance(signature,str) or not _HEX.fullmatch(signature)):
        return False
    try:
        key=_secret("SAAS_P4_ATTESTATION_KEY")
    except AuditRefused:
        return False
    expected=hmac.new(key,("positionary:p4:v1:"+digest).encode(),hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected,signature)


def _version_key(secret, digest, attested):
    payload=f"RECONCILE_V1:{digest}:{int(attested)}"
    return hmac.new(secret,payload.encode(),hashlib.sha256).hexdigest()


def record_reconciliation(identity,broker,subject,account:AccountEvidence,*,attestation=None):
    """Write one atomic immutable decision; no provider or arbitrary DB access.

    All source facts must originate from a separately certified, trusted read
    service. Without that certificate, even a mathematically correct input
    creates a BLOCKED audit only, never a staged execution/position.
    """
    if os.environ.get("SAAS_P4_RECORDING_ENABLED")!="1":
        raise AuditRefused("RECONCILIATION_DISABLED")
    if not isinstance(account,AccountEvidence) or not isinstance(account.workspace_id,UUID) or (
            not isinstance(account.account_id,UUID)):
        raise AuditRefused("INVALID_ACCOUNT")
    secret=_secret("SAAS_SOURCE_HMAC_KEY")
    verdict=reconcile(account)
    digest=_input_digest(account,secret)
    verified=verdict.status=="RECONCILED" and _attested(digest,attestation)
    issues=set(verdict.issue_codes)
    if verdict.status=="RECONCILED" and not verified:
        issues.add("INDEPENDENT_ATTESTATION_REQUIRED")
    decision="STAGED" if verified else "BLOCKED"
    key=_version_key(secret,digest,verified)
    if len(issues)>64 or any(not re.fullmatch(r"[A-Z][A-Z0-9_]{1,63}",c) for c in issues):
        raise AuditRefused("ISSUE_CODE_INVALID")
    sources=[]
    positions=[]
    if verified:
        for f in account.executions:
            _number(f.quantity)
            _number(f.price)
            _number(f.fee)
            sources.append((source_key(secret,"TIGER",account.account_id,"FILL",f.source_id),
                            f.symbol,f.side,f.currency,f.quantity,f.price,f.fee,
                            f.occurred_at.astimezone(timezone.utc)))
        # identical source replays must not violate the append-only PK.
        sources=list({r[0]:r for r in sources}.values())
        for p in verdict.positions:
            _number(p.quantity)
            _number(p.cost_basis)
            _number(p.realized_pnl,signed=True)
            positions.append((p.symbol,p.currency,p.quantity,p.cost_basis,p.realized_pnl))
    with broker.transaction():
        wid=_scope(identity,broker,subject)
        if wid!=str(account.workspace_id):
            raise AuditRefused("ACCOUNT_NOT_AUTHORIZED")
        row=broker.execute("""SELECT a.id FROM saas_broker_accounts a
          JOIN saas_broker_connections c ON c.workspace_id=a.workspace_id
           AND c.id=a.connection_id
          WHERE a.workspace_id=%s AND a.id=%s AND c.provider_code='TIGER'
          FOR UPDATE OF a""",(wid,account.account_id)).fetchone()
        if not row or not _account_authorized(broker,wid,account.account_id):
            raise AuditRefused("ACCOUNT_NOT_AUTHORIZED")
        existing=broker.execute("""SELECT id,version_num,state
          FROM saas_reconciliation_versions
          WHERE workspace_id=%s AND account_id=%s AND evidence_hmac=%s""",
          (wid,account.account_id,key)).fetchone()
        if existing:
            return {"state":existing[2],"version":existing[1],"replayed":True,
                    "issues":sorted(issues),"published":False}
        number=broker.execute("""SELECT coalesce(max(version_num),0)+1
          FROM saas_reconciliation_versions WHERE workspace_id=%s AND account_id=%s""",
          (wid,account.account_id)).fetchone()[0]
        version=broker.execute("""INSERT INTO saas_reconciliation_versions
          (workspace_id,account_id,version_num,evidence_hmac,state,
           checked_fills,duplicate_replays,as_of_utc)
          VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
          (wid,account.account_id,number,key,decision,verdict.checked_fills,
           verdict.duplicate_replays,account.end)).fetchone()[0]
        for code in sorted(issues):
            broker.execute("""INSERT INTO saas_reconciliation_issues
              (workspace_id,version_id,account_id,code) VALUES (%s,%s,%s,%s)""",
              (wid,version,account.account_id,code))
        for src in sources:
            broker.execute("""INSERT INTO saas_verified_execution_stage
              (workspace_id,version_id,account_id,source_key_hmac,symbol,
               side,currency,quantity,price,fee,executed_at_utc)
              VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
              (wid,version,account.account_id,*src))
        for pos in positions:
            broker.execute("""INSERT INTO saas_projection_position_stage
              (workspace_id,version_id,account_id,symbol,currency,quantity,cost_basis,realized_pnl)
              VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
              (wid,version,account.account_id,*pos))
    return {"state":decision,"version":number,"replayed":False,
            "issues":sorted(issues),"published":False}


def review_status(identity,broker,subject):
    """Latest decision per account only; no provider trade identifiers/amounts."""
    with broker.transaction():
        wid=_scope(identity,broker,subject)
        rows=broker.execute("""SELECT DISTINCT ON (v.account_id)
             v.id,v.account_id,a.alias,v.version_num,v.state,v.created_at
          FROM saas_reconciliation_versions v
          JOIN saas_broker_accounts a ON a.workspace_id=v.workspace_id
            AND a.id=v.account_id
          WHERE v.workspace_id=%s
          ORDER BY v.account_id,v.version_num DESC
          LIMIT 50""",(wid,)).fetchall()
        issue_by_id={}
        for version,*_ in rows:
            issue_by_id[version]=[
                r[0] for r in broker.execute("""SELECT code FROM saas_reconciliation_issues
                   WHERE workspace_id=%s AND version_id=%s ORDER BY code LIMIT 64""",
                   (wid,version)).fetchall()]
    return {"provider":"TIGER","published":False,
            "accounts":[{"accountId":str(account),"alias":alias,"version":number,
                         "state":state,"createdAt":created.isoformat(),
                         "issues":issue_by_id[vid]}
                        for vid,account,alias,number,state,created in rows]}
