"""Read-only, tenant-bound view of *independently released* Tiger ledger facts.

No issuer, data importer, order route or raw provider identifier. Reading is
disabled by default and refuses stale, superseded or altered origin evidence.
The broker connection uses saas_broker_app (SELECT on immutable releases).
"""
from __future__ import annotations

import hmac
import os
from uuid import UUID

from services.saas_api.backfill_worker import _account_authorized
from services.saas_api.ledger_publication import _approved, _candidate, PublicationRefused
from services.saas_api.tiger_oauth import _scope

_MAX_ACCOUNTS = 25
_MAX_VISIBLE_FILLS = 100
_MAX_VISIBLE_POSITIONS = 100


def _read_enabled() -> bool:
    return (os.environ.get("SAAS_P4_LEDGER_READ_ENABLED") == "1"
            and os.environ.get("SAAS_P4_PUBLICATION_ENABLED") == "1"
            and os.environ.get("TIGER_PARTNER_OAUTH_APPROVED") == "1"
            and os.environ.get("TIGER_READ_ONLY_GRANT_VERIFIED") == "1")


def _matching_published_review(broker, wid, account_id):
    """Return verified staged content only when the latest audit is published.

    No client-supplied account or review version. Recompute the exact signed
    content digest and re-check all original encrypted provider stage versions
    before emitting even one execution/position. A later BLOCKED decision
    suppresses the old release, without deleting its audit record.
    """
    record = broker.execute("""SELECT v.id,v.version_num,v.state,p.publication_digest,
           p.publication_signature,p.source_count,p.id
         FROM saas_reconciliation_versions v
         LEFT JOIN saas_broker_ledger_publications p
           ON p.workspace_id=v.workspace_id AND p.account_id=v.account_id
          AND p.review_version_id=v.id
         WHERE v.workspace_id=%s AND v.account_id=%s
         ORDER BY v.version_num DESC LIMIT 1""", (wid, account_id)).fetchone()
    if not record or record[2] != "STAGED" or record[3] is None:
        return None
    review_id, version, _, digest, signature, source_count, pub_id = record
    try:
        vid, num, as_of, fills, positions, recalculated = _candidate(broker, wid, account_id)
    except PublicationRefused:
        return None
    if (vid != review_id or num != version
            or not hmac.compare_digest(str(digest), recalculated)
            or not _approved(recalculated, signature)
            or source_count != len(fills)):
        return None
    links = broker.execute("""SELECT source_key_hmac,source_stage_id,evidence_sha256
          FROM saas_broker_ledger_sources
          WHERE workspace_id=%s AND publication_id=%s AND account_id=%s
            AND review_version_id=%s ORDER BY source_key_hmac""",
          (wid, pub_id, account_id, vid)).fetchall()
    if tuple((str(key), str(stage), str(sha)) for key,stage,sha in links) != tuple(
            (str(key),str(stage),str(sha)) for key,stage,sha,*_ in fills):
        return None
    return version, as_of, fills, positions


def private_ledger(identity, broker, subject):
    """Signed internal status + optional verified facts, never an authenticated
    browser API on its own. All account lookups use fresh OWNER membership,
    tenant FORCE RLS and currently connected query-only Tiger consent.
    """
    with broker.transaction():
        wid = _scope(identity, broker, subject)
        if not _read_enabled():
            return {"provider":"TIGER","readEnabled":False,
                    "coverage":"UNVERIFIED","accounts":[],
                    "executions":[],"positions":[],"truncated":False}
        # All accounts must be considered; never silently omit over-limit ones.
        accounts=broker.execute("""SELECT a.id,a.alias
            FROM saas_broker_accounts a
            JOIN saas_broker_connections c ON c.workspace_id=a.workspace_id
             AND c.id=a.connection_id AND c.provider_code='TIGER'
            WHERE a.workspace_id=%s ORDER BY a.created_at,a.id LIMIT 26""",
            (wid,)).fetchall()
        if len(accounts)>_MAX_ACCOUNTS:
            raise PublicationRefused("ACCOUNT_READ_LIMIT")
        statuses=[]
        executions=[]
        positions=[]
        for account_id, alias in accounts:
            # Serialize with P4 reconciliation/publication writers so a
            # just-superseded review cannot be read as the current version
            # while another request appends a BLOCKED audit.
            broker.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s,0))",
                           (str(wid)+":"+str(account_id),))
            if not _account_authorized(broker,wid,account_id):
                statuses.append({"accountId":str(account_id),"alias":alias,
                                 "state":"NOT_AUTHORIZED"})
                continue
            result=_matching_published_review(broker,wid,account_id)
            if result is None:
                statuses.append({"accountId":str(account_id),"alias":alias,
                                 "state":"NOT_VERIFIED"})
                continue
            version, as_of, fills, projected=result
            statuses.append({"accountId":str(account_id),"alias":alias,
                             "state":"VERIFIED","version":version,
                             "asOf":as_of.isoformat()})
            for key,stage,sha,symbol,side,currency,qty,price,fee,occurred in fills:
                executions.append({
                    "sourceRef":str(key),"accountId":str(account_id),
                    "symbol":symbol,"side":side,"currency":currency,
                    "quantity":format(qty,'f'),"price":format(price,'f'),"fee":format(fee,'f'),
                    "executedAt":occurred.isoformat(),"reviewVersion":version,
                    "provenance":"BROKER_VERIFIED"})
            for symbol,currency,qty,cost,realized in projected:
                positions.append({
                    "accountId":str(account_id),"symbol":symbol,
                    "currency":currency,"quantity":format(qty,'f'),
                    "costBasis":format(cost,'f'),"realizedPnl":format(realized,'f'),
                    "asOf":as_of.isoformat(),"reviewVersion":version,
                    "provenance":"BROKER_VERIFIED"})
        executions.sort(key=lambda r:(r["executedAt"],r["sourceRef"]),reverse=True)
        positions.sort(key=lambda r:(r["accountId"],r["symbol"],r["currency"]))
        truncated=(len(executions)>_MAX_VISIBLE_FILLS
                   or len(positions)>_MAX_VISIBLE_POSITIONS)
        return {"provider":"TIGER","readEnabled":True,
                "coverage":"VERIFIED_ACCOUNTS_ONLY",
                "accounts":statuses,
                "executions":executions[:_MAX_VISIBLE_FILLS],
                "positions":positions[:_MAX_VISIBLE_POSITIONS],
                "truncated":truncated}
