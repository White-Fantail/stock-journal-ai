"""Google subject -> separate SaaS account + personal workspace (transactional)."""
from __future__ import annotations

import re
from typing import Any

_GOOGLE_SUBJECT = re.compile(r"^[0-9]{3,255}$")
_EMAIL = re.compile(r"^[^\s@]{1,64}@[^\s@]{1,253}$")


def validate_google_claims(data: Any) -> tuple[str, str, str]:
    """Never authorize by email alone; subject is the immutable Google identity."""
    if not isinstance(data, dict) or data.get("email_verified") is not True:
        raise ValueError("UNVERIFIED_IDENTITY")
    subject = data.get("subject")
    email = data.get("email")
    name = data.get("name", "")
    if not isinstance(subject, str) or not _GOOGLE_SUBJECT.fullmatch(subject):
        raise ValueError("INVALID_SUBJECT")
    if not isinstance(email, str) or len(email) > 320 or not _EMAIL.fullmatch(email):
        raise ValueError("INVALID_EMAIL")
    if not isinstance(name, str):
        name = ""
    return subject, email.lower(), name[:120]


def provision(connection, claims: dict) -> dict:
    """Idempotent, concurrent-safe onboarding. No legacy imports or broker calls."""
    subject, email, name = validate_google_claims(claims)
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute(
                """INSERT INTO saas_users (google_subject,email,display_name)
                   VALUES (%s,%s,%s)
                   ON CONFLICT (google_subject) DO UPDATE
                     SET email=EXCLUDED.email, display_name=EXCLUDED.display_name,
                         updated_at=now()
                   WHERE saas_users.status='ACTIVE'
                   RETURNING id""",
                (subject,email,name),
            )
            row = cursor.fetchone()
            if row is None:
                raise ValueError("ACCOUNT_DISABLED")
            user_id = row[0]
            cursor.execute(
                """INSERT INTO saas_workspaces (owner_user_id)
                   VALUES (%s)
                   ON CONFLICT (owner_user_id) DO UPDATE SET owner_user_id=EXCLUDED.owner_user_id
                   WHERE saas_workspaces.status='ACTIVE'
                   RETURNING id""",
                (user_id,),
            )
            w = cursor.fetchone()
            if w is None:
                raise ValueError("WORKSPACE_DISABLED")
            workspace_id = w[0]
            cursor.execute(
                """INSERT INTO saas_workspace_memberships
                       (workspace_id,user_id,role,status)
                   VALUES (%s,%s,'OWNER','ACTIVE')
                   ON CONFLICT (workspace_id,user_id) DO NOTHING""",
                (workspace_id,user_id),
            )
            cursor.execute(
                """INSERT INTO saas_workspace_settings (workspace_id)
                   VALUES (%s) ON CONFLICT DO NOTHING""", (workspace_id,)
            )
            cursor.execute(
                """SELECT 1 FROM saas_workspace_memberships
                   WHERE workspace_id=%s AND user_id=%s
                   AND role='OWNER' AND status='ACTIVE'""",
                (workspace_id,user_id),
            )
            if cursor.fetchone() is None:
                raise ValueError("MEMBERSHIP_REVOKED")
    return {"userId":str(user_id),"workspaceId":str(workspace_id),"role":"OWNER"}


def resolve(connection, subject: Any) -> dict | None:
    if not isinstance(subject, str) or not _GOOGLE_SUBJECT.fullmatch(subject):
        return None
    with connection.cursor() as cursor:
        cursor.execute(
            """SELECT u.id, w.id
               FROM saas_users u
               JOIN saas_workspaces w ON w.owner_user_id=u.id AND w.status='ACTIVE'
               JOIN saas_workspace_memberships m
                 ON m.workspace_id=w.id AND m.user_id=u.id
                AND m.status='ACTIVE' AND m.role='OWNER'
               WHERE u.google_subject=%s AND u.status='ACTIVE'""",
            (subject,),
        )
        row = cursor.fetchone()
    if not row:
        return None
    return {"userId":str(row[0]),"workspaceId":str(row[1]),"role":"OWNER"}
