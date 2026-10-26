"""Explicit, transactional account removal. Rejects existing broker secret handles."""
from __future__ import annotations

from services.saas_api.trades import TradeInputError, TradeConflict, TradeNotFound
from services.saas_api.identity import resolve


def delete_account(identity_conn, subject: str, confirmation: object) -> dict:
    if confirmation != "DELETE_MY_ACCOUNT":
        raise TradeInputError("Account deletion requires exact confirmation")
    # An API error leaves the entire account intact. No broker tokens are ever deleted blindly.
    with identity_conn.transaction():
        scope = resolve(identity_conn, subject)
        if not scope or scope["role"] != "OWNER":
            raise TradeNotFound("Active workspace not found")
        wid, uid = scope["workspaceId"], scope["userId"]
        row = identity_conn.execute(
            "SELECT id FROM saas_workspaces WHERE id=%s AND owner_user_id=%s FOR UPDATE",
            (wid,uid)
        ).fetchone()
        if not row:
            raise TradeNotFound("Workspace ownership missing")
        linked = identity_conn.execute("""
            SELECT 1 FROM saas_broker_connections
            WHERE workspace_id=%s AND credential_handle IS NOT NULL LIMIT 1
        """,(wid,)).fetchone()
        if linked:
            raise TradeConflict("Disconnect and revoke broker credentials before account deletion")
        # Private record ordering respects the immutable VOID reference and composite FKs.
        identity_conn.execute("DELETE FROM saas_journal_plan_revisions WHERE workspace_id=%s", (wid,))
        identity_conn.execute("DELETE FROM saas_journal_records WHERE workspace_id=%s", (wid,))
        identity_conn.execute("DELETE FROM saas_trade_events WHERE workspace_id=%s AND event_kind='VOID'", (wid,))
        identity_conn.execute("DELETE FROM saas_trade_events WHERE workspace_id=%s", (wid,))
        identity_conn.execute("DELETE FROM saas_journal_entries WHERE workspace_id=%s", (wid,))
        identity_conn.execute("DELETE FROM saas_broker_sync_runs WHERE workspace_id=%s", (wid,))
        identity_conn.execute("DELETE FROM saas_broker_accounts WHERE workspace_id=%s", (wid,))
        identity_conn.execute("DELETE FROM saas_broker_connections WHERE workspace_id=%s", (wid,))
        identity_conn.execute("DELETE FROM saas_workspace_settings WHERE workspace_id=%s", (wid,))
        identity_conn.execute("DELETE FROM saas_workspace_memberships WHERE workspace_id=%s", (wid,))
        identity_conn.execute("DELETE FROM saas_workspaces WHERE id=%s", (wid,))
        identity_conn.execute("DELETE FROM saas_users WHERE id=%s", (uid,))
    return {"deleted": True}
