"""Apply versioned SaaS schema ONLY to explicitly acknowledged disposable localhost test DB.

This is NOT a Railway/production migration runner. The order and SHA-256 of
every applied SQL file are pinned in saas_schema_versions and cannot be edited.
"""
from __future__ import annotations
import hashlib
import os
import pathlib
import sys
from urllib.parse import urlparse

import psycopg

SCHEMAS = tuple(sorted((pathlib.Path(__file__).parent / "migrations").glob("[0-9][0-9][0-9]_*.sql")))

def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in ("--apply", "--verify"):
        raise SystemExit("Use --apply or --verify")
    dsn = os.environ.get("SAAS_DATABASE_URL", "")
    parsed = urlparse(dsn)
    if (os.environ.get("SAAS_TEST_DB_ACK") != "YES_DISPOSABLE_SAAS_DB"
        or parsed.hostname not in ("localhost", "127.0.0.1", "::1")
        or not parsed.path.endswith("_saas_test")
        or parsed.scheme not in ("postgres", "postgresql")):
        raise SystemExit("REFUSED: SaaS test migration only supports disposable localhost *_saas_test DB")
    if not SCHEMAS or [p.name[:3] for p in SCHEMAS] != [
        f"{i:03d}" for i in range(1, len(SCHEMAS) + 1)
    ]:
        raise SystemExit("REFUSED: SaaS migration versions are not contiguous")
    with psycopg.connect(dsn) as con:
        with con.transaction():
            with con.cursor() as c:
                c.execute("""CREATE TABLE IF NOT EXISTS saas_schema_versions (
                            name text PRIMARY KEY, sha256 char(64) NOT NULL)""")
                for schema in SCHEMAS:
                    content = schema.read_text()
                    digest = hashlib.sha256(content.encode()).hexdigest()
                    c.execute("SELECT sha256 FROM saas_schema_versions WHERE name=%s", (schema.name,))
                    row = c.fetchone()
                    if row and row[0] != digest:
                        raise SystemExit("SCHEMA CHECKSUM MISMATCH")
                    if not row:
                        if sys.argv[1] == "--verify":
                            raise SystemExit("UNAPPLIED SCHEMA")
                        c.execute(content)
                        c.execute("INSERT INTO saas_schema_versions VALUES (%s,%s)", (schema.name, digest))
                c.execute("SELECT name FROM saas_schema_versions ORDER BY name")
                applied = [row[0] for row in c.fetchall()]
                if applied != [p.name for p in SCHEMAS]:
                    raise SystemExit("REFUSED: unexpected applied migration version")
    print("SAAS SCHEMA " + ("VERIFIED" if sys.argv[1] == "--verify"
                            else "APPLIED/UNCHANGED") + f" ({len(SCHEMAS)} versions)")

if __name__ == "__main__":
    main()
