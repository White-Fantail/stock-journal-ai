"""Complete month-window process summary over tenant RLS, never recent-feed slices.

Author-created notes, plans, and manual assertions only. SQL aggregates avoid
the 200/200/50 most-recent-feed limits and do not transmit raw narratives.
No broker-order proof, historical returns, quote calls or market-data writes.
"""
from __future__ import annotations

import calendar
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from services.saas_api.trades import (
    TradeInputError, TradeConflict, _confirmed_scope, _runtime_safety, _tenant_scope,
)

_NZ=ZoneInfo("Pacific/Auckland")
_MONTH=re.compile(r"^20[2-9][0-9]-(?:0[1-9]|1[0-2])$")
_MAX_TICKERS=100
_MONTHS={"MONTHLY":1,"QUARTERLY":3,"SEMIANNUAL":6,"ANNUAL":12}


def month_bounds(month, now=None):
    if not isinstance(month,str) or not _MONTH.fullmatch(month):
        raise TradeInputError("Invalid report month")
    now=datetime.now(timezone.utc) if now is None else now
    if not isinstance(now,datetime) or now.tzinfo is None or now.utcoffset() is None:
        raise TradeInputError("Invalid report clock")
    now=now.astimezone(timezone.utc)
    year,number=(int(v) for v in month.split("-"))
    start=datetime(year,number,1,tzinfo=_NZ).astimezone(timezone.utc)
    y,m=(year+1,1) if number==12 else (year,number+1)
    end=datetime(y,m,1,tzinfo=_NZ).astimezone(timezone.utc)
    if start>now:
        raise TradeInputError("Future report month")
    cutoff=min(end,now)
    return start,end,cutoff


def _next_review(at,cadence):
    local=at.astimezone(_NZ)
    if cadence=="WEEKLY":
        return (local+timedelta(days=7)).astimezone(timezone.utc)
    months=_MONTHS.get(cadence)
    if months is None:
        return None
    index=local.year*12+local.month-1+months
    year,zero=divmod(index,12)
    day=min(local.day,calendar.monthrange(year,zero+1)[1])
    return local.replace(year=year,month=zero+1,day=day).astimezone(timezone.utc)


def _query_rows(trade, sql, args, *, label):
    rows=trade.execute(sql+" LIMIT %s",(*args,_MAX_TICKERS+1)).fetchall()
    if len(rows)>_MAX_TICKERS:
        raise TradeConflict("Too many distinct symbols for complete "+label+" summary")
    return rows


def monthly_process(identity, trade, subject, month, *, now=None):
    start,end,cutoff=month_bounds(month,now)
    scope=_confirmed_scope(identity,subject)
    wid=scope["workspaceId"]
    with trade.transaction():
        _runtime_safety(trade)
        _tenant_scope(trade,scope)
        notes=_query_rows(trade, """SELECT ticker,count(*),
              count(*) FILTER (WHERE entry_kind='REVIEW')
            FROM saas_journal_records
            WHERE workspace_id=%s AND created_at >= %s AND created_at < %s
            GROUP BY ticker ORDER BY ticker""",
            (wid,start,cutoff),label="journal")
        plans=_query_rows(trade, """SELECT ticker,count(*)
            FROM saas_journal_plan_revisions
            WHERE workspace_id=%s AND created_at >= %s AND created_at < %s
            GROUP BY ticker ORDER BY ticker""",
            (wid,start,cutoff),label="plan")
        executions=_query_rows(trade, """SELECT ticker,count(*)
            FROM saas_trade_events
            WHERE workspace_id=%s AND created_at >= %s AND created_at < %s
              AND event_kind='EXECUTION'
            GROUP BY ticker ORDER BY ticker""",
            (wid,start,cutoff),label="manual executions")
        voids=int(trade.execute("""SELECT count(*) FROM saas_trade_events
            WHERE workspace_id=%s AND created_at >= %s AND created_at < %s
              AND event_kind='VOID'""",(wid,start,cutoff)).fetchone()[0])
        latest=_query_rows(trade, """SELECT DISTINCT ON(ticker)
              ticker,strategy_type,investment_horizon,invalidation_condition,
              max_allocation_pct,review_cadence,created_at
            FROM saas_journal_plan_revisions
            WHERE workspace_id=%s AND created_at < %s
            ORDER BY ticker,created_at DESC,id DESC""",
            (wid,cutoff),label="active strategy")
        # Immutable user self-assessments: this is a process metric, not
        # audited adherence to brokerage positions or the investment thesis.
        assessments=trade.execute("""SELECT self_assessment,count(*)
            FROM saas_journal_plan_checkins
            WHERE workspace_id=%s AND created_at >= %s AND created_at < %s
            GROUP BY self_assessment""",(wid,start,cutoff)).fetchall()
        tickers=[row[0] for row in latest]
        reviews=(_query_rows(trade, """SELECT ticker,max(created_at)
            FROM saas_journal_records
            WHERE workspace_id=%s AND entry_kind='REVIEW'
              AND created_at < %s AND ticker=ANY(%s)
            GROUP BY ticker ORDER BY ticker""",
            (wid,cutoff,tickers),label="strategy reviews") if tickers else [])

    symbols={}
    def touch(ticker):
        return symbols.setdefault(ticker,{"ticker":ticker,"notes":0,
             "reviews":0,"plans":0,"manualRecords":0})
    for ticker,count,review_count in notes:
        obj=touch(ticker)
        obj["notes"]=int(count)
        obj["reviews"]=int(review_count)
    for ticker,count in plans:touch(ticker)["plans"]=int(count)
    for ticker,count in executions:touch(ticker)["manualRecords"]=int(count)
    if len(symbols)>_MAX_TICKERS:
        raise TradeConflict("Too many distinct symbols for complete monthly summary")
    last_reviews={symbol:at for symbol,at in reviews}
    due=0
    complete=0
    for ticker,strategy,horizon,invalidation,limit,cadence,created in latest:
        complete+=int(all((strategy,horizon,invalidation,limit is not None,cadence)))
        if cadence=="EVENT_DRIVEN" or cadence is None:
            continue
        last=max(created,last_reviews.get(ticker,created))
        deadline=_next_review(last,cadence)
        if deadline is not None and deadline<cutoff:
            due+=1
    items=sorted(symbols.values(),
          key=lambda s:(-(s["notes"]+s["plans"]+s["manualRecords"]),s["ticker"]))
    return {
      "month":month,"timezone":"Pacific/Auckland",
      "start":start.isoformat(),"end":end.isoformat(),
      "checkedAsOf":(cutoff-timedelta(microseconds=1)).isoformat(),
      "noteCount":sum(int(row[1]) for row in notes),
      "reviewCount":sum(int(row[2]) for row in notes),
      "planRevisionCount":sum(int(row[1]) for row in plans),
      "userTradeRecordCount":sum(int(row[1]) for row in executions),
      "voidCount":voids,
      "uniqueSymbols":len(symbols),"symbols":items,
      "plannedSymbols":len(latest),"completeStrategySymbols":complete,
      "dueAsOfCutoff":due,
      "selfReviewCount":sum(int(r[1]) for r in assessments),
      "selfReviewBreakdown":{status:next((int(count) for item,count in assessments
                               if item==status),0)
                            for status in ("FOLLOWED","PARTIAL","DEVIATED","UNCERTAIN")},
      "adherenceBasis":"USER_SELF_ASSESSED_NOT_BROKER_VERIFIED",
      "source":"USER_AUTHORED_PROCESS_ONLY",
      "coverage":"MONTH_WINDOW_DB_AGGREGATED","complete":True,
    }
