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
        # First remove children of immutable journal/plan/broker evidence. The
        # explicit ordering follows the reviewed 001-024 composite foreign keys.
        # Tenant scope is always a locked OWNER workspace, never a user-supplied ID.
        # Any new referencing table must be added here *and* to the disposable
        # delete/export regression suite before release. Failure rolls back all.
        for table in (
            "saas_journal_plan_checkins",
            "saas_journal_records",  # cascades journal broker/observation links
            "saas_journal_plan_revisions",
            "saas_broker_ledger_sources",
            "saas_broker_ledger_publications",
            "saas_reconciliation_source_links",
            "saas_projection_position_stage",
            "saas_verified_execution_stage",
            "saas_reconciliation_issues",
            "saas_reconciliation_versions",
            "saas_broker_source_stage",
            "saas_broker_dispatch_queue",
            "saas_broker_backfill_windows",
            "saas_broker_backfill_jobs",
            "saas_tiger_personal_sync_health",
            "saas_tiger_source_snapshots",
            "saas_tiger_account_secrets",
            "saas_tiger_grants",
            "saas_tiger_oauth_attempts",
            "saas_ai_request_quotas",
        ):
            identity_conn.execute(
                "DELETE FROM "+table+" WHERE workspace_id=%s", (wid,)
            )
        # VOID rows refer to EXECUTION rows in the same tenant.
        identity_conn.execute("DELETE FROM saas_trade_events WHERE workspace_id=%s AND event_kind='VOID'", (wid,))
        for table in (
            "saas_trade_events",
            "saas_journal_entries",
            "saas_broker_sync_runs",
            "saas_broker_accounts",
            "saas_broker_connections",
            "saas_workspace_settings",
            "saas_workspace_memberships",
            "saas_workspaces",
        ):
            identity_conn.execute("DELETE FROM "+table+" WHERE "+(
                "id=%s" if table=="saas_workspaces" else "workspace_id=%s"
            ), (wid,))
        identity_conn.execute("DELETE FROM saas_users WHERE id=%s", (uid,))
    return {"deleted": True}
