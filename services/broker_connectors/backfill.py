"""Deterministic, read-only P3 historical backfill planning.

Only a server-resolved tenant/account/grant may authorize execution. This module
never opens a provider session or publishes financial history.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import hmac
from uuid import UUID

MAX_WINDOWS = 256


def utc(value):
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Timezone-aware bounds required")
    return value.astimezone(timezone.utc)


@dataclass(frozen=True)
class Window:
    ordinal: int
    start_utc: datetime
    end_utc: datetime


@dataclass(frozen=True)
class Plan:
    workspace_id: UUID
    connection_id: UUID
    account_id: UUID
    idempotency_key: str
    windows: tuple[Window, ...]


def plan_backfill(workspace_id, connection_id, account_id, start, end, *, days=30):
    if any(not isinstance(v, UUID) for v in (workspace_id, connection_id, account_id)):
        raise TypeError("Server-resolved UUID identities required")
    if isinstance(days, bool) or not isinstance(days, int) or not 1 <= days <= 89:
        raise ValueError("Window length must be 1..89 days")
    cursor, stop = utc(start), utc(end)
    if cursor >= stop:
        raise ValueError("Positive interval required")
    windows = []
    while cursor < stop:
        if len(windows) >= MAX_WINDOWS:
            raise ValueError("Too many windows; split the backfill into jobs")
        following = min(cursor + timedelta(days=days), stop)
        windows.append(Window(len(windows), cursor, following))
        cursor = following
    identity = (str(workspace_id), str(connection_id), str(account_id),
                windows[0].start_utc.isoformat(), stop.isoformat(), str(days))
    key = sha256("\x1f".join(identity).encode("utf-8")).hexdigest()
    return Plan(workspace_id, connection_id, account_id, key, tuple(windows))


@dataclass(frozen=True)
class WindowResult:
    ordinal: int
    state: str
    attempts: int
    issues: tuple[str, ...] = ()


def coverage(plan: Plan, results: tuple[WindowResult, ...]):
    """Return (state, completed, total, issue codes); missing is never COMPLETE.

    'COMPLETE' is meaningful only if a future trusted worker proves pagination,
    account entitlement and source coverage before saving a completed window.
    """
    allowed = {"PENDING", "RUNNING", "COMPLETE", "PARTIAL", "FAILED", "AUTH_REQUIRED"}
    seen = {}
    for item in results:
        if (item.state not in allowed or not 0 <= item.attempts <= 5 or
                not 0 <= item.ordinal < len(plan.windows) or item.ordinal in seen):
            raise ValueError("Invalid or duplicate checkpoint")
        seen[item.ordinal] = item
    finished = sum(item.state == "COMPLETE" for item in seen.values())
    state = ("COMPLETE" if finished == len(plan.windows) else
             "PARTIAL" if any(r.state in {"PARTIAL","FAILED","AUTH_REQUIRED"}
                              for r in seen.values()) else "PENDING")
    issues = tuple(sorted({code for r in seen.values() for code in r.issues}))
    return state, finished, len(plan.windows), issues


def source_key(secret: bytes, provider: str, account_id: UUID, kind: str, source_id: str):
    """HMAC provider source ID; raw provider IDs belong in encrypted evidence only."""
    if not isinstance(secret, bytes) or len(secret) < 32:
        raise ValueError("Dedicated strong HMAC key required")
    if not isinstance(account_id, UUID) or provider != "TIGER":
        raise ValueError("Unsupported provider identity")
    if kind not in {"ORDER", "FILL", "CASH", "CORPORATE_ACTION"}:
        raise ValueError("Unsupported source type")
    if not isinstance(source_id, str) or not source_id.strip() or len(source_id) > 256:
        raise ValueError("Invalid provider source identity")
    payload = "\x1f".join((provider,str(account_id),kind,source_id)).encode("utf-8")
    return hmac.new(secret, payload, "sha256").hexdigest()
