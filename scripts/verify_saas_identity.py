"""Disposable PostgreSQL identity and tenant boundary verification."""
from __future__ import annotations
import os
import pathlib
import sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import psycopg
from services.saas_api.identity import provision, resolve, validate_google_claims

def main():
    dsn=os.environ["SAAS_DATABASE_URL"]
    if os.environ.get("SAAS_TEST_DB_ACK")!="YES_DISPOSABLE_SAAS_DB":
        raise SystemExit("Refused: test DB acknowledgement missing")
    a={"subject":"1000000000001","email":"a@example.invalid","name":"A","email_verified":True}
    b={"subject":"1000000000002","email":"b@example.invalid","name":"B","email_verified":True}
    with psycopg.connect(dsn) as c:
        ra=provision(c,a)
        assert provision(c,a)==ra, "idempotency lost"
        rb=provision(c,b)
        assert ra["userId"]!=rb["userId"] and ra["workspaceId"]!=rb["workspaceId"], "tenant collision"
        assert resolve(c,a["subject"])==ra and resolve(c,b["subject"])==rb
        assert resolve(c,"1000000000003") is None
        try:
            validate_google_claims({**a,"email_verified":False})
        except ValueError:
            pass
        else:
            raise AssertionError("unverified Google email accepted")
        # An account cannot be merged solely on an identical email address.
        another=provision(c,{**b,"email":a["email"]})
        assert another["userId"]==rb["userId"] and another["userId"]!=ra["userId"]
        # Docker's CI PostgreSQL owner is a superuser and BYPASSES RLS even
        # when FORCE ROW LEVEL SECURITY is enabled. Explicitly switch to an
        # unprivileged query role, otherwise this test would be meaningless.
        c.execute("CREATE ROLE saas_rls_test NOLOGIN NOSUPERUSER NOBYPASSRLS")
        c.execute("GRANT USAGE ON SCHEMA public TO saas_rls_test")
        c.execute("GRANT SELECT, INSERT ON saas_journal_entries TO saas_rls_test")
        c.execute("SET ROLE saas_rls_test")
        # The private tenant journal table has FORCE RLS; a workspace selector
        # is mandatory and even a correct foreign key cannot cross tenants.
        with c.transaction():
            c.execute("SELECT set_config('saas.workspace_id', %s, true)",(ra["workspaceId"],))
            c.execute("""INSERT INTO saas_journal_entries
                        (workspace_id,author_user_id,ticker,note)
                        VALUES (%s,%s,'TSLA','synthetic A')""",
                     (ra["workspaceId"],ra["userId"]))
            assert c.execute("SELECT count(*) FROM saas_journal_entries").fetchone()[0] == 1
        with c.transaction():
            c.execute("SELECT set_config('saas.workspace_id', %s, true)",(rb["workspaceId"],))
            assert c.execute("SELECT count(*) FROM saas_journal_entries").fetchone()[0] == 0, "workspace B can see A's journal"
            c.execute("""INSERT INTO saas_journal_entries
                        (workspace_id,author_user_id,ticker,note)
                        VALUES (%s,%s,'NVDA','synthetic B')""",
                     (rb["workspaceId"],rb["userId"]))
            assert c.execute("SELECT count(*) FROM saas_journal_entries").fetchone()[0] == 1
        with c.transaction():
            c.execute("SELECT set_config('saas.workspace_id', %s, true)",(ra["workspaceId"],))
            assert c.execute("SELECT count(*) FROM saas_journal_entries").fetchone()[0] == 1, "workspace A can see B's journal"
            try:
                with c.transaction():
                    c.execute("""INSERT INTO saas_journal_entries
                                (workspace_id,author_user_id,ticker,note)
                                VALUES (%s,%s,'NVDA','forged tenant')""",
                             (rb["workspaceId"],rb["userId"]))
            except psycopg.errors.InsufficientPrivilege:
                pass
            else:
                raise AssertionError("Cross-workspace journal insertion was permitted")
        c.execute("RESET ROLE")
        # Revocation must immediately disable existing signed JWT sessions via
        # server-side subject->membership resolution.
        with c.transaction():
            c.execute("UPDATE saas_workspace_memberships SET status='REVOKED' WHERE user_id=%s",
                      (rb["userId"],))
        assert resolve(c,b["subject"]) is None
    print("SAAS IDENTITY PASS: distinct users, email safety, RLS cross-tenant deny, revocation")

if __name__=="__main__":
    main()
