"""Synthetic database-backed proof that a monthly report surpasses feed limits.

Disposable PostgreSQL only; tenant scope always set through the non-BYPASSRLS
saas_trade_runtime role. The script does not touch operational data.
"""
import os
from datetime import datetime,timezone
from uuid import uuid4
import psycopg
from services.saas_api.identity import provision
from services.saas_api.monthly_process import monthly_process
from services.saas_api.trades import _runtime_safety

NOW=datetime(2026,10,27,tzinfo=timezone.utc)
STAMP=datetime(2026,10,20,tzinfo=timezone.utc)


def add_synthetic_rows(conn,user):
    wid,uid=user["workspaceId"],user["userId"]
    with conn.transaction():
        conn.execute("SELECT set_config('saas.workspace_id',%s,true)",(wid,))
        conn.execute("SELECT set_config('saas.user_id',%s,true)",(uid,))
        for index in range(215):
            kind="REVIEW" if index<7 else "THESIS"
            conn.execute("""INSERT INTO saas_journal_records
              (workspace_id,author_user_id,idempotency_key,request_hash,
               ticker,entry_kind,text_content,created_at)
              VALUES (%s,%s,%s,%s,'TEST',%s,'synthetic private note',%s)""",
              (wid,uid,str(uuid4()),"a"*64,kind,STAMP))
        for index in range(216):
            conn.execute("""INSERT INTO saas_journal_plan_revisions
              (workspace_id,author_user_id,idempotency_key,request_hash,
               ticker,rationale,created_at,strategy_type,investment_horizon,
               invalidation_condition,max_allocation_pct,review_cadence)
              VALUES (%s,%s,%s,%s,'TEST','synthetic',%s,'LONG_TERM',
                'OVER_THREE_YEARS','synthetic thesis invalidation',25,'MONTHLY')""",
              (wid,uid,str(uuid4()),"b"*64,STAMP))
        for index in range(55):
            conn.execute("""INSERT INTO saas_trade_events
              (workspace_id,author_user_id,idempotency_key,request_hash,
               event_kind,ticker,side,quantity,price,currency,executed_at,
               executed_at_source,rationale,created_at)
              VALUES (%s,%s,%s,%s,'EXECUTION','TEST','BUY',1,100,'USD',
               %s,'2026-10-20T00:00:00Z','synthetic',%s)""",
              (wid,uid,str(uuid4()),"c"*64,STAMP,STAMP))


def main():
    if os.getenv("SAAS_TEST_DB_ACK")!="YES_DISPOSABLE_SAAS_DB":
        raise SystemExit("REFUSED: disposable DB acknowledgement required")
    with psycopg.connect(os.environ["SAAS_DATABASE_URL"]) as admin, \
         psycopg.connect(os.environ["SAAS_DATABASE_URL"]) as trade:
        a=provision(admin,{"subject":"1000000000881","name":"Month A",
                           "email":"month-a@example.invalid","email_verified":True})
        b=provision(admin,{"subject":"1000000000882","name":"Month B",
                           "email":"month-b@example.invalid","email_verified":True})
        trade.execute("SET ROLE saas_trade_runtime")
        trade.commit()
        _runtime_safety(trade)
        trade.commit()
        add_synthetic_rows(trade,a)
        result=monthly_process(admin,trade,"1000000000881","2026-10",now=NOW)
        assert result["complete"] is True and result["coverage"]=="MONTH_WINDOW_DB_AGGREGATED"
        assert result["noteCount"]==215 and result["reviewCount"]==7
        assert result["planRevisionCount"]==216 and result["userTradeRecordCount"]==55
        assert result["plannedSymbols"]==1 and result["completeStrategySymbols"]==1
        assert result["uniqueSymbols"]==1 and result["symbols"][0]["ticker"]=="TEST"
        assert result["dueAsOfCutoff"]==0
        empty=monthly_process(admin,trade,"1000000000882","2026-10",now=NOW)
        assert empty["noteCount"]==0 and empty["planRevisionCount"]==0
        assert empty["userTradeRecordCount"]==0 and empty["plannedSymbols"]==0
        previous=monthly_process(admin,trade,"1000000000881","2026-09",now=NOW)
        assert previous["noteCount"]==0 and previous["planRevisionCount"]==0
        assert previous["plannedSymbols"]==0
        # Direct application role may not access cross-tenant rows by forging a WHERE.
        with trade.transaction():
            trade.execute("SELECT set_config('saas.workspace_id',%s,true)",
                          (b["workspaceId"],))
            assert trade.execute("""SELECT count(*) FROM saas_journal_records
                     WHERE workspace_id=%s""",(a["workspaceId"],)).fetchone()[0]==0
    print("MONTHLY REPORT PASS: >200 notes and plans, >50 trades, tenant RLS, NZ month")


if __name__=="__main__":
    main()
