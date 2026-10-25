"""Atomic one-use signed-request nonces and DB-backed multi-instance rate limits."""
from __future__ import annotations

import hashlib
import re
from datetime import datetime, timedelta, timezone

_NONCE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")


class RequestRejected(ValueError):
    pass


def valid_nonce(value: object) -> bool:
    return isinstance(value, str) and bool(_NONCE.fullmatch(value))


def consume_signed_request(conn, path: str, subject: object, nonce: str) -> None:
    """Run *before* any operation. Commit nonce even on failed business request.

    Identity DB privileges required; never call with tenant RLS runtime login.
    Unique insert is concurrency safe across API replicas.
    """
    if not valid_nonce(nonce) or not isinstance(subject, str) or not re.fullmatch(r"[0-9]{3,255}", subject):
        raise RequestRejected("Malformed request identity")
    nonce_digest = hashlib.sha256(nonce.encode("ascii")).hexdigest()
    key = hashlib.sha256((path + "\0" + subject).encode("utf-8")).hexdigest()
    now = datetime.now(timezone.utc)
    bucket = int(now.timestamp() // 60)
    limit = 12 if path.endswith("/provision") else 120
    with conn.transaction():
        fresh = conn.execute("""
            INSERT INTO saas_internal_request_nonces (nonce_sha256,expires_at)
            VALUES (%s,%s) ON CONFLICT DO NOTHING RETURNING nonce_sha256
        """, (nonce_digest, now + timedelta(minutes=2))).fetchone()
        if fresh is None:
            raise RequestRejected("Replayed signed request")
        counter = conn.execute("""
            INSERT INTO saas_internal_rate_limits
                 (route_subject_sha256,minute_bucket,request_count)
            VALUES (%s,%s,1)
            ON CONFLICT (route_subject_sha256,minute_bucket)
            DO UPDATE SET request_count=saas_internal_rate_limits.request_count + 1
            WHERE saas_internal_rate_limits.request_count < %s
            RETURNING request_count
        """, (key, bucket, limit)).fetchone()
        if counter is None:
            raise RequestRejected("Request limit exceeded")
        # Amortized housekeeping, no bearer material logged or returned.
        if bucket % 32 == 0:
            conn.execute("DELETE FROM saas_internal_request_nonces WHERE expires_at < now()")
            conn.execute("DELETE FROM saas_internal_rate_limits WHERE minute_bucket < %s", (bucket - 10,))
