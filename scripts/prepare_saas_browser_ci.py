"""Create a fresh synthetic-only browser E2E database and limited SQL runtime."""
import os,subprocess,sys,time,urllib.request
import psycopg

if os.environ.get("SAAS_TEST_DB_ACK")!="YES_DISPOSABLE_SAAS_DB" or (
    os.environ.get("POSITIONARY_BROWSER_CI")!="1"
):
 raise SystemExit("Only disposable CI DB may be prepared")
root=os.environ["SAAS_DATABASE_URL"]
if "localhost" not in root and "127.0.0.1" not in root:
 raise SystemExit("No remote database for browser E2E")
name="journal_saas_browser_test"
with psycopg.connect(root,autocommit=True) as conn:
 conn.execute("CREATE DATABASE "+name)
dsn="postgresql://saas_ci:synthetic_only@localhost:5432/"+name
env={**os.environ,"SAAS_DATABASE_URL":dsn}
subprocess.run([sys.executable,"-m","services.saas_api.schema_admin",
  "--apply","--approve-schema-change","--backup-verified"],env=env,check=True)
with psycopg.connect(dsn,autocommit=True) as conn:
 conn.execute("""CREATE ROLE saas_browser_ci LOGIN PASSWORD 'synthetic_browser_pw'
                 NOSUPERUSER NOBYPASSRLS IN ROLE saas_trade_runtime""")
 conn.execute("GRANT CONNECT ON DATABASE "+name+" TO saas_browser_ci")
with open("/tmp/positionary_browser_db.env","w",encoding="utf8") as fp:
 fp.write("SAAS_DATABASE_URL="+dsn+"\n")
 fp.write("SAAS_TRADE_DATABASE_URL=postgresql://saas_browser_ci:synthetic_browser_pw@localhost:5432/"+name+"\n")
print("Disposable browser SQL schema and non-BYPASSRLS role ready")
