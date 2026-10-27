"""Disposable Postgres RLS evidence for persistent user-labelled risk factors."""
import os,pathlib,sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from uuid import uuid4
import psycopg
from services.saas_api.identity import provision
from services.saas_api.risk_factors import save_risk_factors,list_risk_factors
from services.saas_api.trades import TradeConflict

def main():
 if os.getenv("SAAS_TEST_DB_ACK")!="YES_DISPOSABLE_SAAS_DB":
  raise SystemExit("REFUSED: use disposable postgres")
 with psycopg.connect(os.environ["SAAS_DATABASE_URL"]) as admin,\
      psycopg.connect(os.environ["SAAS_DATABASE_URL"]) as trade:
  for sub in ("1000000000551","1000000000552"):
   provision(admin,{"subject":sub,"name":"Synthetic risk author",
    "email":sub+"@example.invalid","email_verified":True})
  trade.execute("SET ROLE saas_trade_runtime");trade.commit()
  first="1000000000551";other="1000000000552"
  payload={"idempotencyKey":str(uuid4()),"ticker":"TSLA",
   "factors":["US_TECH","AI_INFRA"],"rationale":"synthetic user tag"}
  result=save_risk_factors(admin,trade,first,payload)
  replay=save_risk_factors(admin,trade,first,payload)
  assert replay["id"]==result["id"] and replay["replayed"]
  try:save_risk_factors(admin,trade,first,{**payload,"factors":[]})
  except TradeConflict:pass
  else:raise AssertionError("risk tag idempotency mismatch accepted")
  items=list_risk_factors(admin,trade,first)["riskFactors"]
  assert len(items)==1 and set(items[0]["factors"])=={"US_TECH","AI_INFRA"}
  assert list_risk_factors(admin,trade,other)["riskFactors"]==[]
  new=save_risk_factors(admin,trade,first,{
   **payload,"idempotencyKey":str(uuid4()),"factors":[],"rationale":"explicitly unclassify"})
  items=list_risk_factors(admin,trade,first)["riskFactors"]
  assert len(items)==1 and items[0]["id"]==new["id"] and items[0]["factors"]==[]
  scope=admin.execute("""SELECT w.id FROM saas_workspaces w
       JOIN saas_users u ON u.id=w.owner_user_id
       WHERE u.google_subject=%s""",(first,)).fetchone()[0]
  with trade.transaction():
   trade.execute("SELECT set_config('saas.workspace_id',%s,true)",(str(scope),))
   for sql in ("UPDATE saas_risk_factor_revisions SET factors='{}'","DELETE FROM saas_risk_factor_revisions"):
    try:
     with trade.transaction():trade.execute(sql)
    except psycopg.errors.InsufficientPrivilege:pass
    else:raise AssertionError("risk factor history is mutable")
  print("RISK FACTORS PASS: append-only, revisions, replay, RLS A/B, removed tags")
if __name__=="__main__":main()
