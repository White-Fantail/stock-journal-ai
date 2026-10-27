"""Disposable PostgreSQL + real localhost HTTP A/B isolation and replay test.

Not a Google browser OAuth test. Only synthetic identities and local ephemeral data.
"""
from __future__ import annotations
import hashlib
import hmac
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from uuid import uuid4
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import psycopg

from services.saas_api.identity import resolve

PORT = "18181"
BASE = f"http://127.0.0.1:{PORT}"
SECRET = "ci-only-hmac-secret-should-never-be-deployed-0123456789"


def request(path: str, payload: dict, nonce: str | None = None) -> tuple[int, dict]:
    body=json.dumps(payload,separators=(",",":")).encode()
    stamp=str(int(time.time()))
    nonce=nonce or str(uuid4())
    signature=hmac.new(SECRET.encode(),
        f"{stamp}\n{nonce}\nPOST\n{path}\n".encode()+body,hashlib.sha256).hexdigest()
    req=urllib.request.Request(BASE+path,data=body,method="POST",headers={
        "Content-Type":"application/json",
        "X-Saas-Timestamp":stamp,
        "X-Saas-Nonce":nonce,
        "X-Saas-Signature":signature,
    })
    try:
        with urllib.request.urlopen(req,timeout=7) as res:
            return res.status,json.loads(res.read())
    except urllib.error.HTTPError as err:
        return err.code,json.loads(err.read())


def main():
    if os.environ.get("SAAS_TEST_DB_ACK")!="YES_DISPOSABLE_SAAS_DB":
        raise SystemExit("Only disposable CI database may run HTTP tests")
    dsn=os.environ["SAAS_DATABASE_URL"]
    with psycopg.connect(dsn,autocommit=True) as db:
        db.execute("""CREATE ROLE saas_http_ci LOGIN PASSWORD 'http-ci-password'
                      NOSUPERUSER NOBYPASSRLS IN ROLE saas_trade_runtime""")
    trade_dsn=dsn.replace("saas_ci:synthetic_only","saas_http_ci:http-ci-password")
    env={**os.environ,"SAAS_DATABASE_URL":dsn,"SAAS_TRADE_DATABASE_URL":trade_dsn,
         "SAAS_INTERNAL_SECRET":SECRET,"PORT":PORT}
    p=subprocess.Popen([sys.executable,"-m","services.saas_api.server"],
        env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        for attempt in range(50):
            if p.poll() is not None:
                raise RuntimeError("HTTP service exited")
            try:
                with urllib.request.urlopen(BASE+"/healthz",timeout=1) as res:
                    if res.status==200: break
            except (OSError,urllib.error.URLError):
                time.sleep(.1)
        else: raise RuntimeError("No local HTTP healthz")

        A,B="9000000000000000001","9000000000000000002"
        for sub in [A,B]:
            code,out=request("/internal/v1/provision",{
                "subject":sub,"email":sub+"@example.invalid","email_verified":True,"name":"Synthetic"})
            assert code==200,(code,out)
        key=str(uuid4())
        trade={"idempotencyKey":key,"kind":"EXECUTION","confirm":True,
               "ticker":"TSLA","side":"BUY","quantity":"1","price":"100",
               "currency":"USD","fee":None,"executedAt":"2026-10-20T15:00:00-04:00",
               "rationale":"Synthetic user assertion"}
        code,a_trade=request("/internal/v1/trades/create",{"subject":A,"trade":trade})
        assert code==200,(code,a_trade)
        code,replayed=request("/internal/v1/trades/create",{"subject":A,"trade":trade})
        assert code==200 and replayed["replayed"]
        code,own=request("/internal/v1/trades/list",{"subject":A})
        assert code==200 and len(own["events"])==1
        code,other=request("/internal/v1/trades/list",{"subject":B})
        assert code==200 and other["events"]==[]
        code,_=request("/internal/v1/trades/create",{"subject":B,"trade":{
            "idempotencyKey":str(uuid4()),"kind":"VOID","confirm":True,
            "voidsEventId":a_trade["id"],"rationale":"forged cross-tenant"}})
        assert code==404,code

        note={"idempotencyKey":str(uuid4()),"kind":"THESIS","ticker":"TSLA",
              "content":"Synthetic investment hypothesis","tradeEventId":None}
        code,_=request("/internal/v1/journal/create",{"subject":A,"entry":note})
        assert code==200,code
        # Target/stop revisions are independent journal annotations, not broker
        # orders or verified holdings. Signed HTTP access remains tenant scoped.
        plan={"idempotencyKey":str(uuid4()),"ticker":"TSLA","targetPrice":"250.25",
              "stopPrice":"175.50","priceCurrency":"USD",
              "rationale":"Synthetic private plan only"}
        code,created=request("/internal/v1/journal/plan/create",{"subject":A,"plan":plan})
        assert code==200 and "id" in created,(code,created)
        code,replayed=request("/internal/v1/journal/plan/create",{"subject":A,"plan":plan})
        assert code==200 and replayed["replayed"],(code,replayed)
        code,_=request("/internal/v1/journal/plan/create",{"subject":A,
            "plan":{**plan,"targetPrice":"260.00"}})
        assert code==409,code
        code,plans=request("/internal/v1/journal/plans",{"subject":A})
        assert code==200 and len(plans["plans"])==1,(code,plans)
        assert plans["plans"][0]["targetPrice"]=="250.250000000000"
        assert plans["plans"][0]["isBrokerOrder"] is False
        assert plans["plans"][0]["provenance"]=="USER_AUTHORED"
        code,other_plans=request("/internal/v1/journal/plans",{"subject":B})
        assert code==200 and other_plans["plans"]==[],(code,other_plans)
        code,_=request("/internal/v1/journal/plans",
            {"subject":A,"workspaceId":"forged"})
        assert code==400,code
        second={**plan,"idempotencyKey":str(uuid4()),"targetPrice":"280.00",
                "stopPrice":None,"rationale":"Synthetic revised target"}
        code,revision=request("/internal/v1/journal/plan/create",
            {"subject":A,"plan":second})
        assert code==200 and revision["id"]!=created["id"]
        code,versions=request("/internal/v1/journal/plans",{"subject":A})
        assert code==200 and len(versions["plans"])==2
        assert versions["plans"][0]["targetPrice"]=="280.000000000000"
        strategy={**plan,"idempotencyKey":str(uuid4()),
            "targetPrice":None,"stopPrice":None,"priceCurrency":None,
            "strategyType":"LONG_TERM","investmentHorizon":"OVER_THREE_YEARS",
            "invalidationCondition":"My fictional thesis is invalidated",
            "maxAllocationPct":"18.50","reviewCadence":"QUARTERLY",
            "rationale":"Synthetic long-horizon strategy"}
        code,strategic=request("/internal/v1/journal/plan/create",
            {"subject":A,"plan":strategy})
        assert code==200 and "id" in strategic,(code,strategic)
        code,replayed=request("/internal/v1/journal/plan/create",
            {"subject":A,"plan":strategy})
        assert code==200 and replayed["replayed"],(code,replayed)
        code,history=request("/internal/v1/journal/plans",{"subject":A})
        assert code==200 and len(history["plans"])==3,(code,history)
        assert any(p["strategyType"]=="LONG_TERM" and
                   p["maxAllocationPct"]=="18.50" for p in history["plans"])
        code,none=request("/internal/v1/journal/plans",{"subject":B})
        assert code==200 and none["plans"]==[],(code,none)
        code,_=request("/internal/v1/journal/plan/create",
            {"subject":A,"plan":{**strategy,"maxAllocationPct":"150"}})
        assert code==400,code
        # Real HTTP self-review write, replay and export across auth A/B.
        checkin={"idempotencyKey":str(uuid4()),"ticker":"TSLA",
                 "expectedPlanRevisionId":strategic["id"],
                 "selfAssessment":"PARTIAL",
                 "content":"Synthetic documented adherence decision",
                 "nextAction":"Review the original strategy memo"}
        code,own_context=request("/internal/v1/journal/checkin/context",
                                 {"subject":A,"ticker":"TSLA"})
        assert code==200 and own_context["currentPlan"]["id"]==strategic["id"],(code,own_context)
        code,private_context=request("/internal/v1/journal/checkin/context",
                                     {"subject":B,"ticker":"TSLA"})
        assert code==200 and private_context["currentPlan"] is None,(code,private_context)
        code,checkin_created=request("/internal/v1/journal/checkin/create",
                                     {"subject":A,"checkin":checkin})
        assert code==200 and checkin_created["replayed"] is False,(code,checkin_created)
        code,checkin_replay=request("/internal/v1/journal/checkin/create",
                                    {"subject":A,"checkin":checkin})
        assert code==200 and checkin_replay["replayed"] is True,(code,checkin_replay)
        assert checkin_replay["id"]==checkin_created["id"]
        code,_=request("/internal/v1/journal/checkin/create",{"subject":B,"checkin":checkin})
        assert code==404,code
        code,_=request("/internal/v1/journal/checkin/context",
                       {"subject":A,"ticker":"TSLA","workspaceId":"forged"})
        assert code==400,code
        # A signed next-action report is explicit and owner-scoped. It does not
        # mark any broker trade or past self-assessment as verified/compliant.
        code,action_empty=request("/internal/v1/review/actions",{"subject":A})
        assert code==200 and action_empty["complete"] and len(action_empty["items"])==1
        assert action_empty["items"][0]["state"] is None
        code,other_action=request("/internal/v1/review/actions",{"subject":B})
        assert code==200 and other_action["items"]==[]
        followup={"idempotencyKey":str(uuid4()),"checkinId":checkin_created["id"],
          "state":"NOT_DONE","note":"Synthetic unfinished personal action"}
        code,first_followup=request("/internal/v1/review/action/resolve",{
          "subject":A,"actionFollowup":followup})
        assert code==200 and first_followup["source"]=="USER_REPORTED_ACTION_ONLY",(code,first_followup)
        code,replay_followup=request("/internal/v1/review/action/resolve",{
          "subject":A,"actionFollowup":followup})
        assert code==200 and replay_followup["replayed"]
        code,_=request("/internal/v1/review/action/resolve",{"subject":A,
          "actionFollowup":{**followup,"state":"DONE"}})
        assert code==409,code
        code,_=request("/internal/v1/review/action/resolve",{"subject":B,
          "actionFollowup":{**followup,"idempotencyKey":str(uuid4())}})
        assert code==404,code
        code,_=request("/internal/v1/review/actions",{"subject":A,"workspaceId":"forged"})
        assert code==400,code
        code,_=request("/internal/v1/review/action/resolve",{"subject":A,
          "actionFollowup":{**followup,"workspaceId":"forged"}})
        assert code==400,code
        code,second_followup=request("/internal/v1/review/action/resolve",{
          "subject":A,"actionFollowup":{**followup,"idempotencyKey":str(uuid4()),
            "state":"DONE","note":"Synthetic self-reported completion"}})
        assert code==200 and second_followup["id"]!=first_followup["id"]
        code,action_ready=request("/internal/v1/review/actions",{"subject":A})
        assert code==200 and action_ready["items"][0]["state"]=="DONE"
        assert action_ready["items"][0]["nextAction"]==checkin["nextAction"]
        # Broker-free personal principles are explicitly authored and tenant isolated.
        principles={"idempotencyKey":str(uuid4()),"objective":"GROWTH",
          "horizon":"OVER_TEN_YEARS","baseCurrency":"NZD","maxSinglePct":"15",
          "riskLimitPct":None,"reviewCadence":"QUARTERLY",
          "note":"Synthetic self-authored long-term objective"}
        code,empty=request("/internal/v1/principles/get",{"subject":A})
        assert code==200 and empty["current"] is None and empty["complete"],(code,empty)
        code,pcreated=request("/internal/v1/principles/save",{"subject":A,"principles":principles})
        assert code==200 and pcreated["source"]=="USER_AUTHORED_ONLY",(code,pcreated)
        code,replayed=request("/internal/v1/principles/save",{"subject":A,"principles":principles})
        assert code==200 and replayed["replayed"] and replayed["id"]==pcreated["id"]
        code,_=request("/internal/v1/principles/save",{
          "subject":A,"principles":{**principles,"objective":"INCOME"}})
        assert code==409,code
        code,own_principles=request("/internal/v1/principles/get",{"subject":A})
        assert code==200 and own_principles["current"]["objective"]=="GROWTH"
        code,other_principles=request("/internal/v1/principles/get",{"subject":B})
        assert code==200 and other_principles["current"] is None
        code,_=request("/internal/v1/principles/get",{"subject":A,"workspaceId":"forged"})
        assert code==400,code
        code,_=request("/internal/v1/principles/save",{
          "subject":A,"principles":{**principles,"workspaceId":"forged"}})
        assert code==400,code
        code,revised=request("/internal/v1/principles/save",{"subject":A,"principles":{
          **principles,"idempotencyKey":str(uuid4()),"maxSinglePct":"10"}})
        assert code==200 and revised["id"]!=pcreated["id"]
        # Owner manual risk tagging is independent from broker positions.
        factors={"idempotencyKey":str(uuid4()),"ticker":"TSLA",
                 "factors":["AI_INFRA","HIGH_GROWTH"],
                 "rationale":"A synthetic user-only risk classification"}
        code,created_factor=request("/internal/v1/risk-factors/create",
                                    {"subject":A,"riskFactors":factors})
        assert code==200 and created_factor["source"]=="USER_CLASSIFIED_ONLY",(code,created_factor)
        code,replayed_factor=request("/internal/v1/risk-factors/create",
                                     {"subject":A,"riskFactors":factors})
        assert code==200 and replayed_factor["replayed"] is True
        code,factor_list=request("/internal/v1/risk-factors/list",{"subject":A})
        assert code==200 and len(factor_list["riskFactors"])==1
        assert factor_list["riskFactors"][0]["factors"]==["AI_INFRA","HIGH_GROWTH"]
        code,other_factor_list=request("/internal/v1/risk-factors/list",{"subject":B})
        assert code==200 and other_factor_list["riskFactors"]==[]
        code,_=request("/internal/v1/risk-factors/create",
           {"subject":A,"riskFactors":factors,"workspaceId":"forged"})
        assert code==400,code
        # Monthly reporting is a signed owner-only DB aggregate, not a capped
        # "latest trade" view or a brokerage performance computation.
        code,month=request("/internal/v1/journal/monthly-process",
                           {"subject":A,"month":"2026-10"})
        assert code==200 and month["complete"] is True,(code,month)
        assert month["source"]=="USER_AUTHORED_PROCESS_ONLY"
        assert month["coverage"]=="MONTH_WINDOW_DB_AGGREGATED"
        assert month["noteCount"]>=1 and month["planRevisionCount"]>=3
        assert month["userTradeRecordCount"]>=1
        code,other_month=request("/internal/v1/journal/monthly-process",
                                 {"subject":B,"month":"2026-10"})
        assert code==200 and other_month["noteCount"]==0,(code,other_month)
        assert other_month["planRevisionCount"]==0
        code,_=request("/internal/v1/journal/monthly-process",
                       {"subject":A,"month":"2026-10","workspaceId":"forged"})
        assert code==400,code
        code,_=request("/internal/v1/journal/monthly-process",
                       {"subject":A,"month":"2027-01"})
        assert code==400,code
        from datetime import datetime,timezone
        # The current NZ ISO week is determined by the service clock.
        today=datetime.now(timezone.utc).astimezone(__import__("zoneinfo").ZoneInfo("Pacific/Auckland")).date()
        monday=today-__import__("datetime").timedelta(days=today.weekday())
        year,weeknum,_=monday.isocalendar()
        week_key=f"{year}-W{weeknum:02d}"
        code,week_data=request("/internal/v1/journal/weekly-process",
                               {"subject":A,"week":week_key})
        assert code==200 and week_data["complete"] is True,(code,week_data)
        assert week_data["coverage"]=="WEEK_WINDOW_DB_AGGREGATED"
        code,b_week=request("/internal/v1/journal/weekly-process",
                            {"subject":B,"week":week_key})
        assert code==200 and b_week["noteCount"]==0,(code,b_week)
        code,_=request("/internal/v1/journal/weekly-process",
                       {"subject":A,"week":week_key,"workspaceId":"forged"})
        assert code==400,code
        # A signed request is NOT a broker publication certificate. This
        # synthetic HTTP harness has no approved broker login or grant.
        forged_note={"idempotencyKey":str(uuid4()),"ticker":"TSLA",
                     "content":"Synthetic forged source", "accountId":str(uuid4()),
                     "sourceRef":"a"*64}
        code,out=request("/internal/v1/journal/broker-note/create",
                         {"subject":A,"brokerNote":forged_note,"workspaceId":str(uuid4())})
        assert code==400,(code,out)
        code,out=request("/internal/v1/journal/broker-note/create",
                         {"subject":A,"brokerNote":forged_note})
        assert code==503 and out.get("error")=="BROKER_DB_ROLE_NOT_CONFIGURED",(code,out)

        code,blist=request("/internal/v1/journal/list",{"subject":B})
        assert code==200 and blist["entries"]==[]
        code,out=request("/internal/v1/journal/export",{"subject":A})
        assert code==200 and out["complete"] and len(out["journal"])==2 and len(out["trades"])==1
        assert len(out["plans"])==3 and all(p["isBrokerOrder"] is False for p in out["plans"])
        assert any(p["strategyType"]=="LONG_TERM" for p in out["plans"])
        assert len(out["actionFollowups"])==2
        assert [x["state"] for x in out["actionFollowups"]]==["NOT_DONE","DONE"]
        assert len(out["planSelfReviews"])==1,(out.get("planSelfReviews"))
        assert out["planSelfReviews"][0]["id"]==checkin_created["id"]
        assert out["planSelfReviews"][0]["planRevisionId"]==strategic["id"]
        assert out["planSelfReviews"][0]["selfAssessment"]=="PARTIAL"
        assert out["planSelfReviews"][0]["nextAction"]=="Review the original strategy memo"
        assert len(out["investorPrinciples"])==2
        assert out["investorPrinciples"][0]["objective"]=="GROWTH"
        assert out["investorPrinciples"][1]["maxSinglePct"]=="10.00"
        assert len(out["riskFactors"])==1
        assert out["riskFactors"][0]["id"]==created_factor["id"]
        code,out=request("/internal/v1/journal/export",{"subject":B})
        assert code==200 and out["journal"]==[] and out["trades"]==[] and out["plans"]==[] and out["planSelfReviews"]==[] and out["riskFactors"]==[] and out["investorPrinciples"]==[] and out["actionFollowups"]==[]
        nonce=str(uuid4())
        code,_=request("/internal/v1/resolve",{"subject":A},nonce)
        assert code==200
        code,refused=request("/internal/v1/resolve",{"subject":A},nonce)
        assert code==429,(code,refused)
        # Non-privileged caller can never pass an arbitrary workspace selector.
        code,_=request("/internal/v1/journal/list",{"subject":A,"workspaceId":"forged"})
        assert code==400,code
        with psycopg.connect(dsn) as db:
            scope=resolve(db,B)
            with db.transaction():
                db.execute("""UPDATE saas_workspace_memberships SET status='REVOKED'
                              WHERE workspace_id=%s AND user_id=%s""",
                              (scope["workspaceId"],scope["userId"]))
        code,_=request("/internal/v1/journal/list",{"subject":B})
        assert code==404,code
        code,_=request("/internal/v1/journal/plans",{"subject":B})
        assert code==404,code
        # A non-credentialled synthetic broker link and sync-health row
        # previously blocked account deletion via an unhandled FK.
        with psycopg.connect(dsn) as db:
            a_scope=resolve(db,A)
            assert a_scope is not None
            wid=a_scope["workspaceId"]
            conn_id=db.execute("""INSERT INTO saas_broker_connections
                (workspace_id,provider_code,auth_mode,status)
                VALUES (%s,'TIGER','SIGNATURE','DISCONNECTED') RETURNING id""",
                (wid,)).fetchone()[0]
            account_id=db.execute("""INSERT INTO saas_broker_accounts
                (workspace_id,connection_id,external_account_fingerprint,alias)
                VALUES (%s,%s,%s,'synthetic only') RETURNING id""",
                (wid,conn_id,"f"*64)).fetchone()[0]
            db.execute("""INSERT INTO saas_tiger_personal_sync_health
                (workspace_id,account_id,run_id,assets_status,orders_status,fills_status)
                VALUES (%s,%s,%s,'OK','PARTIAL','UNAVAILABLE')""",
                (wid,account_id,str(uuid4())))
            db.execute("""INSERT INTO saas_ai_request_quotas
                (workspace_id,period_type,period_start,request_count)
                VALUES (%s,'MONTH','2026-10-01',1)""",(wid,))
        code,_=request("/internal/v1/account/delete",{"subject":A,"confirmation":"not confirmed"})
        assert code==400,code
        code,out=request("/internal/v1/account/delete",{"subject":A,"confirmation":"DELETE_MY_ACCOUNT"})
        assert code==200 and out=={"deleted":True},(code,out)
        code,_=request("/internal/v1/resolve",{"subject":A})
        assert code==404
        with psycopg.connect(dsn) as db:
            # Disposable integration suite shares a schema with other synthetic
            # workspaces. Assert this EXACT user's deletion, never global zero.
            for table in (
                "saas_journal_plan_revisions",
                "saas_journal_plan_checkins",
                "saas_review_action_followups",
                "saas_risk_factor_revisions",
                "saas_investor_principle_revisions",
                "saas_journal_records",
                "saas_ai_request_quotas",
                "saas_tiger_personal_sync_health",
                "saas_broker_accounts",
                "saas_broker_connections",
            ):
                assert db.execute("SELECT count(*) FROM "+table+
                   " WHERE workspace_id=%s",(wid,)).fetchone()[0]==0,table
            assert db.execute("SELECT count(*) FROM saas_workspaces WHERE id=%s",
                (wid,)).fetchone()[0]==0
            assert db.execute("SELECT count(*) FROM saas_users WHERE google_subject=%s",
                (A,)).fetchone()[0]==0
            assert db.execute("SELECT count(*) FROM saas_users WHERE google_subject=%s",
                (B,)).fetchone()[0]==1
        print("P1/P2 HTTP PASS: provision, replay, trade, journal, export, A/B denial, revocation, deletion")
    finally:
        p.terminate()
        try:p.wait(timeout=4)
        except subprocess.TimeoutExpired:p.kill()


if __name__=="__main__": main()
