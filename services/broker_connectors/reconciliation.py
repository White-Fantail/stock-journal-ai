"""Pure P4 account reconciliation gate for independently certified input.

No provider calls, persisted projections, or customer-facing financial output.
Broker snapshots cannot replace missing executions. All arithmetic is Decimal;
an unresolved gap, fee, trade ordering, corporate action or snapshot mismatch
makes account positions UNPUBLISHABLE. Independent provider entitlement/coverage
certification is a mandatory upstream requirement, never inferred here.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID
import re

from .contracts import BrokerPosition
from .fifo_projection import AccountExecutions, NativePosition, VerifiedExecution, project_fifo

_SYMBOL=re.compile(r"^[A-Z0-9.:-]{1,32}$")
_CURRENCY=re.compile(r"^[A-Z]{3}$")
MAX_EXECUTIONS=5000
MAX_WINDOWS=256
MAX_POSITIONS=1000


@dataclass(frozen=True)
class CertifiedWindow:
    start: datetime
    end: datetime
    provider_certified: bool  # independent provider history/range guarantee


@dataclass(frozen=True)
class PositionEvidence:
    as_of: datetime
    positions: tuple[BrokerPosition,...]
    provider_verified: bool


@dataclass(frozen=True)
class AccountEvidence:
    workspace_id: UUID
    account_id: UUID
    start: datetime
    end: datetime
    windows: tuple[CertifiedWindow,...]
    executions: tuple[VerifiedExecution,...]
    snapshot: PositionEvidence | None
    orders_reconciled: bool = False
    cash_activity_reconciled: bool = False
    corporate_actions_reconciled: bool = False


@dataclass(frozen=True)
class Reconciliation:
    status: str  # BLOCKED or RECONCILED; no unverifiable partial values
    issue_codes: tuple[str,...]
    checked_fills: int
    duplicate_replays: int
    positions: tuple[NativePosition,...]  # ONLY if RECONCILED


def _aware(t):
    return isinstance(t, datetime) and t.tzinfo is not None and t.utcoffset() is not None


def _valid_money(value, *, positive=False):
    return (isinstance(value, Decimal) and value.is_finite()
            and (value>0 if positive else value>=0))


def _block(issues, fills=0, repeats=0):
    return Reconciliation("BLOCKED",tuple(sorted(issues)),fills,repeats,())


def reconcile(account: AccountEvidence) -> Reconciliation:
    """Never return quantities/cost basis/P&L until ALL requirements hold."""
    if not isinstance(account,AccountEvidence) or not all(isinstance(x,UUID) for x in (
        account.workspace_id, account.account_id)):
        raise TypeError("Trusted tenant/account evidence required")
    if (not _aware(account.start) or not _aware(account.end)
            or account.end<=account.start):
        return _block({"INVALID_INTERVAL"})
    if (not isinstance(account.windows,tuple) or not isinstance(account.executions,tuple)
            or len(account.windows)>MAX_WINDOWS or len(account.executions)>MAX_EXECUTIONS
            or not all(isinstance(w,CertifiedWindow) for w in account.windows)
            or not all(isinstance(f,VerifiedExecution) for f in account.executions)):
        return _block({"INVALID_SOURCE"})
    issues=set()
    window_ranges=[]
    for w in account.windows:
        if not _aware(w.start) or not _aware(w.end) or w.end<=w.start or type(w.provider_certified) is not bool:
            return _block({"INVALID_WINDOW"})
        window_ranges.append((w.start.astimezone(timezone.utc),w.end.astimezone(timezone.utc),w.provider_certified))
    start=account.start.astimezone(timezone.utc)
    end=account.end.astimezone(timezone.utc)
    window_ranges.sort()
    if not window_ranges:
        issues.add("HISTORY_GAP")
    else:
        boundary=start
        for first,last,certified in window_ranges:
            if first!=boundary or last>end:
                issues.add("HISTORY_GAP")
            if not certified:
                issues.add("HISTORY_COVERAGE_UNVERIFIED")
            boundary=max(boundary,last)
        if boundary!=end:
            issues.add("HISTORY_GAP")
    if account.orders_reconciled is not True:
        issues.add("ORDERS_UNVERIFIED")
    if account.cash_activity_reconciled is not True:
        issues.add("CASH_ACTIVITY_UNVERIFIED")
    if account.corporate_actions_reconciled is not True:
        issues.add("CORPORATE_ACTIONS_UNVERIFIED")
    snapshot=account.snapshot
    snapshot_quantities={}
    if snapshot is None:
        issues.add("SNAPSHOT_UNAVAILABLE")
    elif not isinstance(snapshot,PositionEvidence) or not isinstance(snapshot.positions,tuple) or (
        len(snapshot.positions)>MAX_POSITIONS):
        issues.add("SNAPSHOT_INVALID")
    elif not _aware(snapshot.as_of) or snapshot.as_of.astimezone(timezone.utc)!=end:
        issues.add("SNAPSHOT_ASOF_MISMATCH")
    elif snapshot.provider_verified is not True:
        issues.add("SNAPSHOT_UNVERIFIED")
    else:
        for position in snapshot.positions:
            if not isinstance(position,BrokerPosition) or not isinstance(position.symbol,str) or (
                not _SYMBOL.fullmatch(position.symbol)) or not isinstance(position.currency,str) or (
                not _CURRENCY.fullmatch(position.currency)) or not _valid_money(position.quantity):
                issues.add("SNAPSHOT_INVALID")
                break
            key=(position.symbol,position.currency)
            if key in snapshot_quantities:
                issues.add("SNAPSHOT_DUPLICATE_SYMBOL")
            snapshot_quantities[key]=position.quantity

    by_source={}
    economic=set()
    repeated=0
    for f in account.executions:
        if not isinstance(f.source_id,str) or not f.source_id.strip() or len(f.source_id)>256:
            issues.add("INVALID_EXECUTION")
            continue
        old=by_source.get(f.source_id)
        if old is not None:
            if old!=f:
                issues.add("SOURCE_VERSION_CONFLICT")
            else:
                repeated+=1
            continue
        by_source[f.source_id]=f
        if not isinstance(f.symbol,str) or not _SYMBOL.fullmatch(f.symbol) or f.side not in ("BUY","SELL") or (
            not isinstance(f.currency,str) or not _CURRENCY.fullmatch(f.currency)) or (
            not _valid_money(f.quantity,positive=True)) or not _valid_money(f.price,positive=True) or (
            not _aware(f.occurred_at)):
            issues.add("INVALID_EXECUTION")
            continue
        ts=f.occurred_at.astimezone(timezone.utc)
        if not start<=ts<end:
            issues.add("EXECUTION_OUT_OF_RANGE")
        if not any(first<=ts<last and certified for first,last,certified in window_ranges):
            issues.add("EXECUTION_OUTSIDE_CERTIFIED_WINDOW")
        if f.fee is None:
            issues.add("FEE_UNKNOWN")
        elif not _valid_money(f.fee) or f.fee_currency!=f.currency:
            issues.add("FEE_CURRENCY_UNVERIFIED")
        signature=(f.symbol,f.currency,f.side,f.quantity,f.price,ts,f.fee,f.fee_currency)
        if signature in economic:
            issues.add("POTENTIAL_DUPLICATE_FILL")
        economic.add(signature)
    checked=len(by_source)
    if issues:
        return _block(issues,checked,repeated)

    fifo=project_fifo(AccountExecutions(account.workspace_id,account.account_id,True,True,
                                         tuple(by_source.values())))
    if fifo.status!="CALCULATED":
        return _block(set(fifo.issue_codes) or {"PROJECTION_UNAVAILABLE"},checked,repeated)
    calculated={(p.symbol,p.currency):p.quantity for p in fifo.positions if p.quantity!=0}
    observed={key:qty for key,qty in snapshot_quantities.items() if qty!=0}
    if calculated!=observed:
        return _block({"POSITION_QUANTITY_MISMATCH"},checked,repeated)
    return Reconciliation("RECONCILED",(),checked,repeated,fifo.positions)
