"""Complete owner-scoped weekly review, NZ Monday 00:00 to next Monday.

Current week is partial as-of request time. Full tenant PostgreSQL aggregate,
never the 200-item journal or 50-event feed. User-only self assessments and
next actions, not verified fills, strategy compliance or market returns.
"""
from __future__ import annotations
from datetime import date,datetime,timedelta,timezone
from zoneinfo import ZoneInfo
import re
from services.saas_api.trades import (
    TradeInputError,TradeConflict,_confirmed_scope,_runtime_safety,_tenant_scope,
)
from services.saas_api.monthly_process import _query_rows,_next_review,_MAX_TICKERS

_NZ=ZoneInfo("Pacific/Auckland")
_WEEK=re.compile(r"^20[2-9][0-9]-W(?:0[1-9]|[1-4][0-9]|5[0-3])$")


def week_bounds(week,now=None):
    if not isinstance(week,str) or not _WEEK.fullmatch(week):
        raise TradeInputError("WEEK_INVALID")
    try:
        monday=date.fromisocalendar(int(week[:4]),int(week[6:]),1)
    except ValueError:
        raise TradeInputError("WEEK_INVALID") from None
    now=datetime.now(timezone.utc) if now is None else now
    if not isinstance(now,datetime) or now.tzinfo is None or now.utcoffset() is None:
        raise TradeInputError("WEEK_CLOCK_INVALID")
    now=now.astimezone(timezone.utc)
    start=datetime(monday.year,monday.month,monday.day,tzinfo=_NZ).astimezone(timezone.utc)
    next_day=monday+timedelta(days=7)
    end=datetime(next_day.year,next_day.month,next_day.day,tzinfo=_NZ).astimezone(timezone.utc)
    if start>now:
        raise TradeInputError("WEEK_FUTURE")
    return start,end,min(end,now)


def weekly_process(identity,trade,subject,week,*,now=None):
    start,end,cutoff=week_bounds(week,now)
    scope=_confirmed_scope(identity,subject)
    wid=scope["workspaceId"]
    with trade.transaction():
        _runtime_safety(trade)
        _tenant_scope(trade,scope)
        notes=_query_rows(trade,"""SELECT ticker,count(*),
            count(*) FILTER (WHERE entry_kind='REVIEW')
            FROM saas_journal_records
            WHERE workspace_id=%s AND created_at>=%s AND created_at<%s
            GROUP BY ticker ORDER BY ticker""",(wid,start,cutoff),label="weekly notes")
        plans=_query_rows(trade,"""SELECT ticker,count(*)
            FROM saas_journal_plan_revisions
            WHERE workspace_id=%s AND created_at>=%s AND created_at<%s
            GROUP BY ticker ORDER BY ticker""",(wid,start,cutoff),label="weekly plans")
        checkins=_query_rows(trade,"""SELECT ticker,count(*)
            FROM saas_journal_plan_checkins
            WHERE workspace_id=%s AND created_at>=%s AND created_at<%s
            GROUP BY ticker ORDER BY ticker""",(wid,start,cutoff),label="weekly checkins")
        latest=_query_rows(trade,"""SELECT DISTINCT ON(ticker)
            ticker,review_cadence,created_at FROM saas_journal_plan_revisions
            WHERE workspace_id=%s AND created_at<%s
            ORDER BY ticker,created_at DESC,id DESC""",(wid,cutoff),label="weekly active plans")
        symbols=[row[0] for row in latest]
        review_times=(_query_rows(trade,"""SELECT ticker,max(created_at)
            FROM saas_journal_records WHERE workspace_id=%s
            AND entry_kind='REVIEW' AND created_at<%s AND ticker=ANY(%s)
            GROUP BY ticker ORDER BY ticker""",(wid,cutoff,symbols),
            label="weekly review coverage") if symbols else [])
        # Recent user next-actions: one per ticker, not assumed completed.
        last_checkins=_query_rows(trade,"""SELECT DISTINCT ON(ticker)
            ticker,self_assessment,next_action,created_at
            FROM saas_journal_plan_checkins
            WHERE workspace_id=%s AND created_at<%s
            ORDER BY ticker,created_at DESC,id DESC""",
            (wid,cutoff),label="weekly follow-up")
    activity={}
    def entry(ticker):
        return activity.setdefault(ticker,{"ticker":ticker,"notes":0,"reviews":0,
                                         "plans":0,"selfReviews":0})
    for ticker,count,review in notes:
        row=entry(ticker);row["notes"]=int(count);row["reviews"]=int(review)
    for ticker,count in plans:entry(ticker)["plans"]=int(count)
    for ticker,count in checkins:entry(ticker)["selfReviews"]=int(count)
    last_review=dict(review_times)
    follow={r[0]:r for r in last_checkins}
    tasks=[]
    for ticker,cadence,created in latest:
        if cadence is None or cadence=="EVENT_DRIVEN":
            continue
        anchor=max(created,last_review.get(ticker,created))
        next_due=_next_review(anchor,cadence)
        if next_due is None:
            continue
        prior=follow.get(ticker)
        tasks.append({"ticker":ticker,"cadence":cadence,
          "nextDueAt":next_due.isoformat(),
          "state":"DUE" if next_due<=cutoff else "UPCOMING",
          "lastAssessment":prior[1] if prior else None,
          "lastNextAction":prior[2] if prior else None,
          "lastSelfReviewAt":prior[3].isoformat() if prior else None})
    tasks.sort(key=lambda x:(x["state"]!="DUE",x["nextDueAt"],x["ticker"]))
    if len(activity)>_MAX_TICKERS:
        raise TradeConflict("WEEK_SYMBOL_LIMIT")
    return {"week":week,"timezone":"Pacific/Auckland",
       "start":start.isoformat(),"end":end.isoformat(),
       "checkedAsOf":cutoff.isoformat(),"partial":cutoff<end,
       "source":"USER_AUTHORED_PROCESS_ONLY","coverage":"WEEK_WINDOW_DB_AGGREGATED",
       "complete":True,
       "noteCount":sum(int(r[1]) for r in notes),
       "reviewCount":sum(int(r[2]) for r in notes),
       "planRevisionCount":sum(int(r[1]) for r in plans),
       "selfReviewCount":sum(int(r[1]) for r in checkins),
       "activePlans":len(latest),"duePlans":sum(t["state"]=="DUE" for t in tasks),
       "tasks":tasks,"symbols":sorted(activity.values(),key=lambda x:x["ticker"])}
