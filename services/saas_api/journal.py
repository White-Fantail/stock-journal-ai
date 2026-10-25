"""Tenant-scoped append-only investment notes and export, no brokerage trading."""
from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
import json
import re
from typing import Any
from uuid import UUID

from services.saas_api.trades import (
    TradeInputError, TradeConflict, TradeNotFound,
    _confirmed_scope, _runtime_safety, _tenant_scope, _FIELDS, _as_json,
)

_SYMBOL = re.compile(r"^[A-Z0-9.:-]{1,32}$")
_KINDS = {"THESIS", "STRATEGY", "REVIEW", "TRADE_NOTE", "WATCHLIST_ADD", "WATCHLIST_REMOVE"}
_LIMIT = 5000


def normalize_note(raw: Any) -> dict:
    if not isinstance(raw, dict) or set(raw) - {"idempotencyKey", "kind", "ticker", "content", "tradeEventId"}:
        raise TradeInputError("Invalid journal fields")
    try:
        key = str(UUID(raw["idempotencyKey"]))
    except (KeyError, TypeError, ValueError, AttributeError):
        raise TradeInputError("Invalid journal idempotency key") from None
    kind, ticker, content = raw.get("kind"), raw.get("ticker"), raw.get("content", "")
    if kind not in _KINDS or not isinstance(ticker, str) or not _SYMBOL.fullmatch(ticker):
        raise TradeInputError("Invalid journal kind or ticker")
    if not isinstance(content, str) or len(content) > 6000:
        raise TradeInputError("Invalid journal text")
    content = content.strip()
    watch = kind in {"WATCHLIST_ADD", "WATCHLIST_REMOVE"}
    if (watch and (content or raw.get("tradeEventId"))) or (not watch and not content):
        raise TradeInputError("Invalid journal entry content")
    trade_id = raw.get("tradeEventId")
    if trade_id is not None:
        if kind != "TRADE_NOTE":
            raise TradeInputError("Only trade notes can link a trade event")
        try:
            trade_id = str(UUID(trade_id))
        except (TypeError, ValueError, AttributeError):
            raise TradeInputError("Invalid trade event reference") from None
    return dict(idempotencyKey=key, kind=kind, ticker=ticker,
                content=content, tradeEventId=trade_id)


def _entry(row) -> dict:
    return {"id": str(row[0]), "kind": row[1], "ticker": row[2],
            "content": row[3], "tradeEventId": str(row[4]) if row[4] else None,
            "createdAt": row[5].isoformat(), "provenance": "USER_AUTHORED"}


def list_notes(identity_conn, trade_conn, subject: str) -> dict:
    scope = _confirmed_scope(identity_conn, subject)
    with trade_conn.transaction():
        _runtime_safety(trade_conn)
        _tenant_scope(trade_conn, scope)
        rows = trade_conn.execute("""
            SELECT id,entry_kind,ticker,text_content,trade_event_id,created_at
            FROM saas_journal_records ORDER BY created_at DESC,id DESC LIMIT 200
        """).fetchall()
    return {"entries": [_entry(row) for row in rows], "limit": 200, "source": "USER_AUTHORED_ONLY"}


def create_note(identity_conn, trade_conn, subject: str, raw: Any) -> dict:
    entry = normalize_note(raw)
    scope = _confirmed_scope(identity_conn, subject)
    digest = sha256(json.dumps(entry, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    with trade_conn.transaction():
        _runtime_safety(trade_conn)
        _tenant_scope(trade_conn, scope)
        key = entry["idempotencyKey"]
        old = trade_conn.execute("SELECT id,request_hash FROM saas_journal_records WHERE idempotency_key=%s", (key,)).fetchone()
        if old:
            if old[1].strip() != digest:
                raise TradeConflict("Idempotency mismatch")
            return {"id": str(old[0]), "replayed": True}
        if entry["tradeEventId"]:
            row = trade_conn.execute(
                "SELECT event_kind,ticker FROM saas_trade_events WHERE id=%s",
                (entry["tradeEventId"],)
            ).fetchone()
            if not row or row != ("EXECUTION", entry["ticker"]):
                raise TradeNotFound("Trade event not in workspace or ticker mismatch")
        record = trade_conn.execute("""
            INSERT INTO saas_journal_records
              (workspace_id,author_user_id,idempotency_key,request_hash,
               entry_kind,ticker,text_content,trade_event_id)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (workspace_id,idempotency_key) DO NOTHING RETURNING id
        """, (scope["workspaceId"], scope["userId"], key,digest,
              entry["kind"],entry["ticker"],entry["content"],entry["tradeEventId"])).fetchone()
        if not record:
            old = trade_conn.execute("SELECT id,request_hash FROM saas_journal_records WHERE idempotency_key=%s", (key,)).fetchone()
            if not old or old[1].strip() != digest:
                raise TradeConflict("Concurrent idempotency mismatch")
            return {"id": str(old[0]), "replayed": True}
        return {"id": str(record[0]), "replayed": False}


def export_journal(identity_conn, trade_conn, subject: str) -> dict:
    """Complete bounded, no-store JSON export. Refuse truncation rather than partial success."""
    scope = _confirmed_scope(identity_conn, subject)
    with trade_conn.transaction():
        _runtime_safety(trade_conn)
        _tenant_scope(trade_conn, scope)
        trades = trade_conn.execute(
            f"SELECT {_FIELDS} FROM saas_trade_events ORDER BY created_at,id LIMIT %s",
            (_LIMIT + 1,)
        ).fetchall()
        notes = trade_conn.execute("""
            SELECT id,entry_kind,ticker,text_content,trade_event_id,created_at
            FROM saas_journal_records ORDER BY created_at,id LIMIT %s
        """, (_LIMIT + 1,)).fetchall()
        if len(trades) > _LIMIT or len(notes) > _LIMIT:
            raise TradeConflict("Export exceeds safe complete bound; paginated export required")
    return {"format": "stock-journal-ai.v1", "generatedAt": datetime.now(timezone.utc).isoformat(),
            "workspaceId": scope["workspaceId"], "trades": [_as_json(r) for r in trades],
            "journal": [_entry(r) for r in notes], "complete": True}
