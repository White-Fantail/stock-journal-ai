"""Offline-only coverage plan for owner-scoped Tiger financial-activity reads.

Provider business-date windows are inclusive; FundWindow uses half-open dates.
Keep bounded per-request pages, deliberate one-day overlap between windows,
and mark every page set *unverified* until an independent provider-history
attestation exists. Nothing here can call Tiger, write to DB or publish P&L.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from uuid import UUID

from .tiger_financial_evidence import (
    CATEGORIES, MAX_DAYS, FundEvidenceUnavailable, FundObservationBatch,
    FundWindow,
)

MAX_WINDOWS=60
MAX_HISTORY_DAYS=365*10
WINDOW_DAYS=85  # <= Tiger <=89 days; overlap near business-date boundaries.


@dataclass(frozen=True)
class FinancialCoverageAssessment:
    state: str
    windows: int
    categories: int
    observed_records: int
    history_certified: bool=False
    fees_reconciled: bool=False
    deposits_reconciled: bool=False
    corporate_actions_reconciled: bool=False
    fx_reconciled: bool=False
    total_returns_available: bool=False


def plan_fund_windows(workspace_id: UUID, account_id: UUID,
                      start: date, end: date) -> tuple[FundWindow,...]:
    if (type(start) is not date or type(end) is not date or
            start>=end or start.year<2000 or end.year>2100 or
            (end-start).days>MAX_HISTORY_DAYS):
        raise FundEvidenceUnavailable("HISTORY_RANGE_INVALID")
    windows=[]
    first=start
    while first<end:
        last=min(first+timedelta(days=WINDOW_DAYS),end)
        windows.append(FundWindow(workspace_id,account_id,first,last))
        if len(windows)>MAX_WINDOWS:
            raise FundEvidenceUnavailable("HISTORY_WINDOW_LIMIT")
        if last==end:
            break
        first=last-timedelta(days=1)
    return tuple(windows)


def assess_financial_coverage(
    windows: tuple[FundWindow,...],
    batches: tuple[FundObservationBatch,...],
) -> FinancialCoverageAssessment:
    """Classify shape coverage; never infer complete external transaction history.

    The same economic event may appear in multiple category filters and in
    overlapping date windows. Counts describe *observed source rows only*.
    They must never be summed into cash balances or investment performance.
    """
    if not isinstance(windows,tuple) or not windows or not isinstance(batches,tuple):
        raise FundEvidenceUnavailable("COVERAGE_INPUT_INVALID")
    account=windows[0].account_id
    workspace=windows[0].workspace_id
    for i,window in enumerate(windows):
        if (not isinstance(window,FundWindow) or window.account_id!=account or
                window.workspace_id!=workspace or
                (i and (window.start!=windows[i-1].end-timedelta(days=1)))):
            raise FundEvidenceUnavailable("COVERAGE_WINDOW_GAP")
    expected={(i,cat) for i in range(len(windows)) for cat in CATEGORIES}
    if len(expected)>MAX_WINDOWS*len(CATEGORIES):
        raise FundEvidenceUnavailable("COVERAGE_INPUT_INVALID")
    observed=set()
    count=0
    for item in batches:
        if not isinstance(item,FundObservationBatch) or item.category not in CATEGORIES or (
            item.state!="SHADOW_OBSERVED_ONLY" or item.history_certified
        ):
            raise FundEvidenceUnavailable("COVERAGE_BATCH_INVALID")
        try:
            index=windows.index(item.window)
        except ValueError:
            raise FundEvidenceUnavailable("COVERAGE_WINDOW_UNAUTHORIZED") from None
        key=(index,item.category)
        if key in observed:
            raise FundEvidenceUnavailable("COVERAGE_DUPLICATE_BATCH")
        observed.add(key)
        if item.pages<1 or item.pages>20 or not item.records or len(item.records)>1000:
            raise FundEvidenceUnavailable("COVERAGE_BATCH_INVALID")
        if any(record.filter_category!=item.category or
               record.provenance!="BROKER_OBSERVED_UNVERIFIED" or
               record.amount_precision_verified for record in item.records):
            raise FundEvidenceUnavailable("COVERAGE_PROVENANCE_INVALID")
        count+=len(item.records)
    return FinancialCoverageAssessment(
        "SHAPE_OBSERVED_HISTORY_UNVERIFIED" if observed==expected else
        "PARTIAL_HISTORY_UNVERIFIED",
        len(windows),len(observed),count
    )
