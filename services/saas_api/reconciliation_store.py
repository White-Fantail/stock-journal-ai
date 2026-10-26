"""P4 append-only reconciliation journal and staged account ledger.

Not an HTTP route and not a provider certificate issuer. Only a separate,
approved read-only source verifier can produce a valid attestation. A browser,
broker cursor, synthetic backfill or a successful FIFO result alone cannot
authorize staging. No holdings or P/L is published by this module.
"""
from __future__ import annotations

from datetime import timezone
from decimal import Decimal, InvalidOperation, localcontext
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
    if value.copy_abs() >= Decimal("1e24"):
        raise AuditRefused("NUMERIC_NOT_REPRESENTABLE")
    # Accept only exact numeric(36,12); no monetary rounding on write.
    try:
        with localcontext() as ctx:
            ctx.prec = 64
            if value != value.quantize(Decimal("0.000000000001")):
                raise AuditRefused("NUMERIC_NOT_REPRESENTABLE")
    except InvalidOperation:
        raise AuditRefused("NUMERIC_NOT_REPRESENTABLE") from None
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



def _bound_digest(base_digest, links, secret):
    """Bind the signed decision to exact persisted stage evidence versions."""
    records=sorted((str(stage),key,sha) for stage,key,sha in links)
    raw=json.dumps(["positionary:p4:source-links:v1",base_digest,records],
                   sort_keys=True,separators=(",",":")).encode()
    return hmac.new(secret,raw,hashlib.sha256).hexdigest()


def _find_lineage(broker, wid, account:AccountEvidence, secret):
    """No evidence aliases: a single source ID must resolve to ONE exact version.

    The adapter/independent issuer must separately verify decrypted provider
    payload semantics; a matching fingerprint alone is never certification.
    """
    expected={source_key(secret,"TIGER",account.account_id,"FILL",f.source_id)
              for f in account.executions}
    if len(expected)>5000:
        raise AuditRefused("SOURCE_TOO_LARGE")
    if not expected:
        return (),set()
    rows=broker.execute("""SELECT id,source_key_hmac,evidence_sha256
       FROM saas_broker_source_stage
       WHERE workspace_id=%s AND account_id=%s AND kind='FILL'
         AND source_key_hmac=ANY(%s::text[])
       ORDER BY source_key_hmac,id
       LIMIT 10001""",
       (wid,account.account_id,list(expected))).fetchall()
    by_key={}
    for rid,key,evidence in rows:
        by_key.setdefault(str(key),[]).append((rid,str(key),str(evidence)))
    issues=set()
    if any(key not in by_key for key in expected):
        issues.add("SOURCE_EVIDENCE_MISSING")
    if any(len(values)!=1 for values in by_key.values()) or len(rows)>5000:
        issues.add("SOURCE_EVIDENCE_CONFLICT")
    unique=tuple(values[0] for values in by_key.values() if len(values)==1)
    # A conflicting second source version must change the decision fingerprint
    # even though conflicting rows are intentionally never linked as trusted.
    observed=tuple((rid,str(key),str(sha)) for rid,key,sha in rows)
    return unique,issues,observed


def record_reconciliation(identity,broker,subject,account:AccountEvidence,*,attestation=None):
    """Append an immutable review; verified staging requires exact source lineage.

    This method is internal-only. It neither grants provider coverage nor
    issues proof, and never publishes positions to a customer.
    """
    from services.broker_connectors.reconciliation_issues import summaries
    if os.environ.get("SAAS_P4_RECORDING_ENABLED")!="1":
        raise AuditRefused("RECONCILIATION_DISABLED")
    if not isinstance(account,AccountEvidence) or not isinstance(account.workspace_id,UUID) or (
            not isinstance(account.account_id,UUID)):
        raise AuditRefused("INVALID_ACCOUNT")
    secret=_secret("SAAS_SOURCE_HMAC_KEY")
    verdict=reconcile(account)
    digest=_input_digest(account,secret)
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
        # All signatures are bound to the *actual* tenant-scoped stage rows,
        # not to user-supplied raw source IDs or unauthenticated HTTP claims.
        links,lineage_issues,observed=_find_lineage(broker,wid,account,secret)
        bound_digest=_bound_digest(digest,observed,secret)
        issues=set(verdict.issue_codes)|lineage_issues
        verified=(verdict.status=="RECONCILED" and not lineage_issues
                  and _attested(bound_digest,attestation))
        if verdict.status=="RECONCILED" and not verified:
            issues.add("INDEPENDENT_ATTESTATION_REQUIRED")
        classified=summaries(tuple(sorted(issues)))
        decision="STAGED" if verified else "BLOCKED"
        key=_version_key(secret,bound_digest,verified)
        existing=broker.execute("""SELECT id,version_num,state
          FROM saas_reconciliation_versions
          WHERE workspace_id=%s AND account_id=%s AND evidence_hmac=%s""",
          (wid,account.account_id,key)).fetchone()
        if existing:
            return {"state":existing[2],"version":existing[1],"replayed":True,
                    "issues":sorted(issues),"published":False}

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
            sources=list({r[0]:r for r in sources}.values())
            for p in verdict.positions:
                _number(p.quantity)
                _number(p.cost_basis)
                _number(p.realized_pnl,signed=True)
                positions.append((p.symbol,p.currency,p.quantity,p.cost_basis,p.realized_pnl))

        number=broker.execute("""SELECT coalesce(max(version_num),0)+1
          FROM saas_reconciliation_versions WHERE workspace_id=%s AND account_id=%s""",
          (wid,account.account_id)).fetchone()[0]
        version=broker.execute("""INSERT INTO saas_reconciliation_versions
          (workspace_id,account_id,version_num,evidence_hmac,state,
           checked_fills,duplicate_replays,as_of_utc)
          VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
          (wid,account.account_id,number,key,decision,verdict.checked_fills,
           verdict.duplicate_replays,account.end)).fetchone()[0]
        for issue in classified:
            broker.execute("""INSERT INTO saas_reconciliation_issues
              (workspace_id,version_id,account_id,code,category,severity,evidence_scope)
              VALUES (%s,%s,%s,%s,%s,%s,%s)""",
              (wid,version,account.account_id,issue.code,issue.category,
               issue.severity,issue.scope))
        # Preserve links for BOTH blocked and staged decisions, including
        # independently observed yet unresolved source evidence. Account FK
        # + full stage fingerprint protects against silent repointing.
        for stage,key_hmac,evidence_sha in links:
            broker.execute("""INSERT INTO saas_reconciliation_source_links
              (workspace_id,version_id,account_id,source_stage_id,
               source_key_hmac,evidence_sha256)
              VALUES (%s,%s,%s,%s,%s,%s)""",
              (wid,version,account.account_id,stage,key_hmac,evidence_sha))
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
        link_counts={}
        for version,*_ in rows:
            issue_by_id[version]=[
                {"code":issue[0],"category":issue[1],"severity":issue[2],
                 "scope":issue[3]}
                for issue in broker.execute("""SELECT code,category,severity,evidence_scope
                   FROM saas_reconciliation_issues
                   WHERE workspace_id=%s AND version_id=%s ORDER BY code LIMIT 64""",
                   (wid,version)).fetchall()]
            link_counts[version]=broker.execute("""SELECT count(*)
                FROM saas_reconciliation_source_links
                WHERE workspace_id=%s AND version_id=%s""",(wid,version)).fetchone()[0]
    return {"provider":"TIGER","published":False,
            "accounts":[{"accountId":str(account),"alias":alias,"version":number,
                         "state":state,"createdAt":created.isoformat(),
                         "issues":issue_by_id[vid],"sourceEvidenceCount":link_counts[vid]}
                        for vid,account,alias,number,state,created in rows]}
