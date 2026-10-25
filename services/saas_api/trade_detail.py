"""Read a single immutable financial event by tenant-scoped ID."""
from __future__ import annotations
from uuid import UUID
from services.saas_api.trades import (
    _confirmed_scope,_runtime_safety,_tenant_scope,_FIELDS,_as_json,TradeNotFound,TradeInputError,
)

def trade_detail(identity_conn, trade_conn, subject: str, trade_id: object) -> dict:
    try:
        ident=str(UUID(trade_id))
    except (TypeError,ValueError,AttributeError):
        raise TradeInputError("Invalid event id") from None
    scope=_confirmed_scope(identity_conn,subject)
    with trade_conn.transaction():
        _runtime_safety(trade_conn)
        _tenant_scope(trade_conn,scope)
        row=trade_conn.execute(
            f"SELECT {_FIELDS} FROM saas_trade_events WHERE id=%s", (ident,)
        ).fetchone()
    if not row:
        raise TradeNotFound("Not found in authorized workspace")
    return {"event":_as_json(row)}
