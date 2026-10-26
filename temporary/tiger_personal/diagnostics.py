"""Owner-scoped, read-only Tiger incident diagnostics.

Return only aggregate counts, never credentials, account IDs, symbols, trade data,
or external provider payloads. Uses the existing tenant RLS broker runtime role.
"""
from __future__ import annotations

from services.saas_api.tiger_oauth import _scope
from temporary.tiger_personal.api import owner_only


def view_diagnostics(identity, broker, subject):
    owner_only(subject)
    with broker.transaction():
        workspace = _scope(identity, broker, subject)
        connections = broker.execute("""
            SELECT auth_mode, status, count(*) FROM saas_broker_connections
            WHERE workspace_id=%s AND provider_code='TIGER'
            GROUP BY auth_mode, status ORDER BY auth_mode, status
            """, (workspace,)).fetchall()
        accounts = broker.execute("""
            SELECT count(*) FROM saas_broker_accounts a
            JOIN saas_broker_connections c
              ON c.workspace_id=a.workspace_id AND c.id=a.connection_id
            WHERE a.workspace_id=%s AND c.provider_code='TIGER'
            """, (workspace,)).fetchone()[0]
        readable = broker.execute("""
            SELECT count(*) FROM saas_broker_accounts a
            JOIN saas_broker_connections c
              ON c.workspace_id=a.workspace_id AND c.id=a.connection_id
            WHERE a.workspace_id=%s AND c.provider_code='TIGER'
              AND c.auth_mode='SIGNATURE' AND c.status='PENDING_AUTH'
            """, (workspace,)).fetchone()[0]
        snapshots = broker.execute("""
            SELECT kind, count(*) FROM saas_tiger_source_snapshots
            WHERE workspace_id=%s
            GROUP BY kind ORDER BY kind
            """, (workspace,)).fetchall()
    return {
        "source": "PERSONAL_READ_DIAGNOSTIC",
        "connections": [
            {"mode": mode, "status": status, "count": int(count)}
            for mode, status, count in connections
        ],
        "accountCount": int(accounts),
        "pilotReadableAccountCount": int(readable),
        "snapshotCounts": [
            {"kind": kind, "count": int(count)}
            for kind, count in snapshots
        ],
    }
