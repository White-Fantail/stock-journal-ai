"""Isolated, synthetic-only chained time-weighted return arithmetic.

NEVER expose this helper on HTTP, web or an automated broker publication
path. The published Tiger FIFO positions do not include independently
attested start/end NAV and complete end-of-subperiod external cash flows.

Mathematical convention: each segment's external net cash flow occurs *at
the END* of that segment (cash deposit positive / withdrawal negative).
Monthly/quarterly returns require a new NAV subperiod boundary whenever
an external flow occurs at another time. Dividends, fees and corporate
actions affect NAV, and are not automatically deducted twice.

Results from this module are unconditionally MODEL_ONLY_NOT_PUBLISHABLE even
with all synthetic evidence flags; actual source release requires separate
independent account/window attestation, FX and history proofs.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_EVEN, localcontext
import re
from uuid import UUID

_AMOUNT=re.compile(r"^-?(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$")
_CURRENCY=re.compile(r"^[A-Z]{3}$")
_MAX_SEGMENTS=500
_REQUIRED=frozenset((
    "START_END_NAV_RECONCILED",
    "EXTERNAL_FLOWS_COMPLETE",
    "FLOW_TIMING_AT_SEGMENT_END",
    "FEES_DIVIDENDS_CORPORATE_ACTIONS_RECONCILED",
    "FX_SAME_CURRENCY_OR_ATTESTED",
    "ACCOUNT_HISTORY_COVERAGE_ATTESTED",
))


class PerformanceModelRefused(ValueError):
    """Constant refusal codes; do not expose raw source or customer money."""


@dataclass(frozen=True)
class ProofWindow:
    account_id: UUID
    currency: str
    start: datetime
    end: datetime
    opening_nav: str
    closing_nav: str
    end_external_flow: str
    verified_checks: frozenset[str]


@dataclass(frozen=True)
class ModelReturn:
    percent: str
    periods: int
    currency: str
    state: str="MODEL_ONLY_NOT_PUBLISHABLE"


def _decimal(value: str, *, signed: bool=False) -> Decimal:
    if not isinstance(value,str) or not _AMOUNT.fullmatch(value):
        raise PerformanceModelRefused("DECIMAL_FORMAT_INVALID")
    if not signed and value.startswith("-"):
        raise PerformanceModelRefused("NEGATIVE_NAV")
    try:
        amount=Decimal(value)
    except (InvalidOperation,ValueError):
        raise PerformanceModelRefused("DECIMAL_FORMAT_INVALID") from None
    if not amount.is_finite():
        raise PerformanceModelRefused("DECIMAL_FORMAT_INVALID")
    return amount


def model_chained_return(windows: tuple[ProofWindow,...]) -> ModelReturn:
    """Validate synthetic evidence and compound exact-Decimal subperiod factors.

    Every entry is an end-cashflow subperiod; flow-adjusted value MUST remain
    strictly positive so a standard net long-only capital basis is defined.
    If any segment is missing an independent proof category, refuse the
    complete chain. No price estimates or interpolated FX are accepted.
    """
    if not isinstance(windows,tuple) or not 1<=len(windows)<=_MAX_SEGMENTS:
        raise PerformanceModelRefused("WINDOW_COUNT_INVALID")
    account=windows[0].account_id
    currency=windows[0].currency
    if not isinstance(account,UUID) or not isinstance(currency,str) or not _CURRENCY.fullmatch(currency):
        raise PerformanceModelRefused("ACCOUNT_CURRENCY_INVALID")
    previous:ProofWindow|None=None
    previous_closing:Decimal|None=None
    with localcontext() as ctx:
        ctx.prec=64
        product=Decimal(1)
        for item in windows:
            if not isinstance(item,ProofWindow) or item.account_id!=account or item.currency!=currency:
                raise PerformanceModelRefused("ACCOUNT_SCOPE_MISMATCH")
            if (not isinstance(item.start,datetime) or not isinstance(item.end,datetime)
                    or item.start.tzinfo is None or item.end.tzinfo is None
                    or item.start.utcoffset() is None or item.end.utcoffset() is None
                    or item.start>=item.end):
                raise PerformanceModelRefused("PERIOD_INVALID")
            if previous is not None and previous.end.astimezone(timezone.utc)!=item.start.astimezone(timezone.utc):
                raise PerformanceModelRefused("PERIOD_GAP_OR_OVERLAP")
            if (not isinstance(item.verified_checks,frozenset) or
                    item.verified_checks!=_REQUIRED):
                raise PerformanceModelRefused("SOURCE_EVIDENCE_INCOMPLETE")
            start=_decimal(item.opening_nav)
            close=_decimal(item.closing_nav)
            external=_decimal(item.end_external_flow,signed=True)
            if start<=0 or close<=0 or close-external<=0:
                raise PerformanceModelRefused("NAV_OR_FLOW_INVALID")
            if previous_closing is not None and start!=previous_closing:
                raise PerformanceModelRefused("NAV_CHAIN_MISMATCH")
            product*=((close-external)/start)
            previous=item
            previous_closing=close
        result=(product-Decimal(1))*Decimal(100)
        return ModelReturn(
            percent=str(result.quantize(Decimal("0.0001"),rounding=ROUND_HALF_EVEN)),
            periods=len(windows),currency=currency)
