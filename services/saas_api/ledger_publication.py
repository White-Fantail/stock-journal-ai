"""Offline-only P4 immutable broker-ledger release gate.

A *separate, approved* source auditor must issue the publication signature.
This module never signs, calls Tiger or exposes an HTTP endpoint. The broker
runtime role remains FORCE-RLS restricted, and a current RECONCILED/STAGED
account review is necessary but NOT sufficient for publication.
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

from services.saas_api.backfill_worker import _account_authorized
from services.saas_api.reconciliation_store import _secret
from services.saas_api.tiger_oauth import _scope

_HEX = re.compile(r"^[0-9a-f]{64}$")
_MAX_FILLS = 5000


class PublicationRefused(RuntimeError):
    """Only constant safe error codes. Never include customer/source values."""


def _digest(workspace, account, version_id, version_num, review_hmac, as_of,
            fills, positions):
    """Content fingerprint, binding every referenced original evidence version.

    Only keyed IDs, immutable staged normalized facts and as-of time enter the
    fingerprint. No plaintext external account/order/fill identifier is logged.
    """
    payload = {
        "purpose": "positionary:broker-ledger:release:v1",
        "workspace": str(workspace), "account": str(account),
        "version": str(version_id), "number": version_num,
        "review": str(review_hmac),
        "asOf": as_of.astimezone(timezone.utc).isoformat(),
        "fills": [
            [str(key), str(stage), str(sha), str(symbol), str(side), str(currency),
             str(quantity), str(price), str(fee), at.astimezone(timezone.utc).isoformat()]
            for key, stage, sha, symbol, side, currency, quantity, price, fee, at in fills
        ],
        "positions": [
            [str(symbol), str(currency), str(quantity), str(cost), str(realized)]
            for symbol, currency, quantity, cost, realized in positions
        ],
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"),
                           ensure_ascii=True, allow_nan=False).encode()
    return hashlib.sha256(canonical).hexdigest()


def _approved(digest, signature):
    """Independent release signing key: deliberately not an issuing function."""
    if (os.environ.get("SAAS_P4_PUBLICATION_ENABLED") != "1"
            or os.environ.get("TIGER_PARTNER_OAUTH_APPROVED") != "1"
            or os.environ.get("TIGER_READ_ONLY_GRANT_VERIFIED") != "1"
            or not isinstance(signature, str) or not _HEX.fullmatch(signature)):
        return False
    try:
        key = _secret("SAAS_P4_PUBLICATION_KEY")
    except Exception:
        return False
    wanted = hmac.new(key, ("positionary:p4:publish:v1:" + digest).encode(),
                      hashlib.sha256).hexdigest()
    return hmac.compare_digest(wanted, signature)


def _candidate(broker, wid, account):
    """Must be invoked inside a transaction after tenant+account authorization."""
    row = broker.execute("""SELECT id,version_num,evidence_hmac,state,checked_fills,as_of_utc
         FROM saas_reconciliation_versions
         WHERE workspace_id=%s AND account_id=%s
         ORDER BY version_num DESC LIMIT 1""", (wid, account)).fetchone()
    if not row or row[3] != "STAGED":
        raise PublicationRefused("REVIEW_NOT_RELEASEABLE")
    vid, number, review_hmac, _, expected, as_of = row
    if not isinstance(expected, int) or expected < 0 or expected > _MAX_FILLS:
        raise PublicationRefused("INVALID_REVIEW_COUNTS")

    fills = broker.execute("""SELECT f.source_key_hmac,l.source_stage_id,l.evidence_sha256,
           f.symbol,f.side,f.currency,f.quantity,f.price,f.fee,f.executed_at_utc
         FROM saas_verified_execution_stage f
         JOIN saas_reconciliation_source_links l
           ON l.workspace_id=f.workspace_id AND l.version_id=f.version_id
          AND l.account_id=f.account_id AND l.source_key_hmac=f.source_key_hmac
         WHERE f.workspace_id=%s AND f.account_id=%s AND f.version_id=%s
         ORDER BY f.source_key_hmac""", (wid, account, vid)).fetchall()
    count = broker.execute("""SELECT
        (SELECT count(*) FROM saas_verified_execution_stage
          WHERE workspace_id=%s AND account_id=%s AND version_id=%s),
        (SELECT count(*) FROM saas_reconciliation_source_links
          WHERE workspace_id=%s AND account_id=%s AND version_id=%s)""",
          (wid, account, vid, wid, account, vid)).fetchone()
    if len(fills) != expected or count != (expected, expected):
        raise PublicationRefused("STAGED_SOURCE_INCOMPLETE")

    keys = [str(f[0]) for f in fills]
    if len(set(keys)) != len(keys):
        raise PublicationRefused("STAGED_SOURCE_CONFLICT")
    if keys:
        source_counts = broker.execute("""SELECT source_key_hmac,count(*)
           FROM saas_broker_source_stage
           WHERE workspace_id=%s AND account_id=%s AND kind='FILL'
             AND source_key_hmac=ANY(%s::text[])
           GROUP BY source_key_hmac""", (wid, account, keys)).fetchall()
        if len(source_counts) != expected or any(n != 1 for _, n in source_counts):
            raise PublicationRefused("SOURCE_VERSION_CHANGED")
    positions = broker.execute("""SELECT symbol,currency,quantity,cost_basis,realized_pnl
         FROM saas_projection_position_stage
         WHERE workspace_id=%s AND account_id=%s AND version_id=%s
         ORDER BY symbol,currency""", (wid, account, vid)).fetchall()
    digest = _digest(wid, account, vid, number, review_hmac, as_of, fills, positions)
    return vid, number, as_of, fills, positions, digest


def release_verified_review(identity, broker, subject, account_id, version_num, *,
                            independent_signature=None):
    """Release a currently STAGED review to an append-only, private broker ledger.

    No caller-accessible HTTP route. Release always re-checks authorization and
    exact source versions. Independent auditor approval is required *again* at
    this boundary; successful FIFO accounting or a STAGED flag cannot self-approve.
    Replays return one immutable release. Later blocked reviews supersede its
    visibility, never silently delete/correct an existing release.
    """
    try:
        account = UUID(str(account_id))
    except (ValueError, TypeError, AttributeError):
        raise PublicationRefused("INVALID_ACCOUNT") from None
    if isinstance(version_num, bool) or not isinstance(version_num, int) or version_num < 1:
        raise PublicationRefused("INVALID_VERSION")
    with broker.transaction():
        wid = _scope(identity, broker, subject)
        lock = broker.execute("""SELECT id FROM saas_broker_accounts
          WHERE workspace_id=%s AND id=%s FOR UPDATE""", (wid, account)).fetchone()
        if not lock or not _account_authorized(broker, wid, account):
            raise PublicationRefused("ACCOUNT_NOT_AUTHORIZED")
        vid, number, as_of, fills, positions, digest = _candidate(broker, wid, account)
        if number != version_num:
            raise PublicationRefused("STALE_REVIEW")
        if not _approved(digest, independent_signature):
            raise PublicationRefused("INDEPENDENT_PUBLICATION_REQUIRED")

        existing = broker.execute("""SELECT id,publication_digest
          FROM saas_broker_ledger_publications
          WHERE workspace_id=%s AND account_id=%s AND review_version_id=%s""",
          (wid, account, vid)).fetchone()
        if existing:
            if str(existing[1]) != digest:
                raise PublicationRefused("PUBLICATION_CONFLICT")
            return {"state": "RELEASED", "version": number,
                    "sourceCount": len(fills), "replayed": True}
        release_id = broker.execute("""INSERT INTO saas_broker_ledger_publications
          (workspace_id,account_id,review_version_id,publication_digest,
           review_version_num,as_of_utc,source_count)
          VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
          (wid, account, vid, digest, number, as_of, len(fills))).fetchone()[0]
        for key, stage, sha, *_ in fills:
            broker.execute("""INSERT INTO saas_broker_ledger_sources
              (workspace_id,publication_id,account_id,review_version_id,
               source_key_hmac,source_stage_id,evidence_sha256)
              VALUES (%s,%s,%s,%s,%s,%s,%s)""",
              (wid, release_id, account, vid, key, stage, sha))
        return {"state": "RELEASED", "version": number,
                "sourceCount": len(fills), "replayed": False}
