"""Disposable DB isolation and immutable plan-review checkin integration."""
import os
import pathlib
import sys
from uuid import uuid4

sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import psycopg

from services.saas_api.identity import provision
from services.saas_api.plan_checkins import create_checkin,context
from services.saas_api.journal_plans import create_plan
from services.saas_api.monthly_process import monthly_process
from services.saas_api.trades import TradeConflict,TradeNotFound


def plan(ticker="TEST"):
 return {"idempotencyKey":str(uuid4()),"ticker":ticker,
  "targetPrice":None,"stopPrice":None,"priceCurrency":None,
  "rationale":"Synthetic strategy decision"}


def request(plan_id,status="FOLLOWED",key=None):
 return {"idempotencyKey":key or str(uuid4()),"ticker":"TEST",
         "expectedPlanRevisionId":plan_id,"selfAssessment":status,
         "content":"Synthetic authored decision note",
         "nextAction":"Revisit my original plan after reviewing evidence"}


def main():
 if os.getenv("SAAS_TEST_DB_ACK")!="YES_DISPOSABLE_SAAS_DB":
  raise SystemExit("REFUSED: disposable-only integration")
 with psycopg.connect(os.environ["SAAS_DATABASE_URL"]) as identity,\
      psycopg.connect(os.environ["SAAS_DATABASE_URL"]) as trade:
  a_subject="1000000000771"
  b_subject="1000000000772"
  a=provision(identity,{"subject":a_subject,"name":"Plan A",
      "email":"plan-a@example.invalid","email_verified":True})
  b=provision(identity,{"subject":b_subject,"name":"Plan B",
      "email":"plan-b@example.invalid","email_verified":True})
  trade.execute("SET ROLE saas_trade_runtime")
  trade.commit()
  original=create_plan(identity,trade,a_subject,plan())
  ctx=context(identity,trade,a_subject,"TEST")
  assert ctx["currentPlan"]["id"]==original["id"]
  assert ctx["recent"]==[]
  assert context(identity,trade,b_subject,"TEST")["currentPlan"] is None
  req=request(original["id"])
  saved=create_checkin(identity,trade,a_subject,req)
  again=create_checkin(identity,trade,a_subject,req)
  assert again["id"]==saved["id"] and again["replayed"] is True
  try:
   create_checkin(identity,trade,a_subject,{**req,"selfAssessment":"DEVIATED"})
  except TradeConflict:pass
  else:raise AssertionError("Replayed key with changed assessment accepted")
  assert len(context(identity,trade,a_subject,"TEST")["recent"])==1
  assert context(identity,trade,b_subject,"TEST")["recent"]==[]
  with trade.transaction():
   trade.execute("SELECT set_config('saas.workspace_id',%s,true)",(a["workspaceId"],))
   notes=trade.execute("""SELECT count(*) FROM saas_journal_records
     WHERE workspace_id=%s AND entry_kind='REVIEW' AND ticker='TEST'""",
     (a["workspaceId"],)).fetchone()[0]
   assert notes==1,"Duplicate REVIEW should never be created on replay"
  # Direct limited-role insert must not forge a plan of another ticker or
  # attach a non-REVIEW journal event: database trigger is the last boundary.
  with trade.transaction():
   trade.execute("SELECT set_config('saas.workspace_id',%s,true)",(a["workspaceId"],))
   trade.execute("SELECT set_config('saas.user_id',%s,true)",(a["userId"],))
   note=trade.execute("""SELECT id FROM saas_journal_records
       WHERE workspace_id=%s AND entry_kind='REVIEW' AND ticker='TEST' LIMIT 1""",
       (a["workspaceId"],)).fetchone()[0]
   try:
    with trade.transaction():
     trade.execute("""INSERT INTO saas_journal_plan_checkins
       (workspace_id,author_user_id,idempotency_key,request_hash,ticker,
        plan_revision_id,journal_id,self_assessment,next_action)
       VALUES (%s,%s,%s,%s,'FORGED',%s,%s,'FOLLOWED','forged')""",
       (a["workspaceId"],a["userId"],str(uuid4()),"f"*64,original["id"],note))
   except psycopg.errors.CheckViolation:pass
   else:raise AssertionError("Database accepted forged plan/review ticker linkage")
  for state in ("PARTIAL","DEVIATED","UNCERTAIN"):
   create_checkin(identity,trade,a_subject,request(original["id"],state))
  overview=monthly_process(identity,trade,a_subject,"2026-10")
  assert overview["selfReviewCount"]==4
  assert overview["selfReviewBreakdown"]=={
    "FOLLOWED":1,"PARTIAL":1,"DEVIATED":1,"UNCERTAIN":1}
  assert overview["adherenceBasis"]=="USER_SELF_ASSESSED_NOT_BROKER_VERIFIED"
  assert overview["reviewCount"]==4
  assert monthly_process(identity,trade,b_subject,"2026-10")["selfReviewCount"]==0
  replacement=create_plan(identity,trade,a_subject,plan())
  assert replacement["id"]!=original["id"]
  try:
   create_checkin(identity,trade,a_subject,request(original["id"]))
  except TradeConflict:pass
  else:raise AssertionError("Stale plan revision accepted")
  fresh=create_checkin(identity,trade,a_subject,request(replacement["id"]))
  rows=context(identity,trade,a_subject,"TEST")["recent"]
  assert rows[0]["id"]==fresh["id"] and rows[0]["planRevisionId"]==replacement["id"]
  assert rows[1]["planRevisionId"]==original["id"]
  # No UPDATE or DELETE privilege; self-assessments remain immutable.
  with trade.transaction():
   trade.execute("SELECT set_config('saas.workspace_id',%s,true)",(a["workspaceId"],))
   for sql in ("UPDATE saas_journal_plan_checkins SET self_assessment='FOLLOWED'",
               "DELETE FROM saas_journal_plan_checkins"):
    try:
     with trade.transaction():
      trade.execute(sql)
    except psycopg.errors.InsufficientPrivilege:pass
    else:raise AssertionError("Mutable self-review permissions")
  print("PLAN CHECKINS PASS: atomic REVIEW+assessment, idempotency, stale plan, tenant RLS")


if __name__=="__main__":
 main()
