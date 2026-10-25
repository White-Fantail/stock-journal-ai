"""Deterministic *native-currency* FIFO projection for verified executions only.

This is an offline, pure accounting primitive, NOT a broker-verified portfolio:
corporate actions, cash activity, FX, taxes and market valuation are external
requirements. It cannot be called with raw Tiger BrokerFill (fee currency and
coverage confidence are not yet verified).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
import re
from uuid import UUID

_CURRENCY = re.compile(r"^[A-Z]{3}$")
_SYMBOL = re.compile(r"^[A-Z0-9.:-]{1,32}$")


@dataclass(frozen=True)
class VerifiedExecution:
    source_id: str
    symbol: str
    side: str
    quantity: Decimal
    price: Decimal
    currency: str
    occurred_at: datetime
    fee: Decimal | None
    fee_currency: str | None
    # The source ingestion layer must separately prove chronological/currency
    # accuracy before creating a VerifiedExecution. Never infer it from a
    # missing timezone/unknown Tiger API response.


@dataclass(frozen=True)
class AccountExecutions:
    workspace_id: UUID
    account_id: UUID
    history_covered: bool
    corporate_actions_reconciled: bool
    executions: tuple[VerifiedExecution, ...]


@dataclass(frozen=True)
class NativePosition:
    symbol: str
    currency: str
    quantity: Decimal
    cost_basis: Decimal | None
    realized_pnl: Decimal | None


@dataclass(frozen=True)
class Projection:
    status: str  # CALCULATED, REVIEW_REQUIRED, UNAVAILABLE
    positions: tuple[NativePosition, ...]
    issue_codes: tuple[str, ...]


def _amount(number, *, positive=False):
    return (isinstance(number, Decimal) and number.is_finite()
            and (number > 0 if positive else number >= 0))


def project_fifo(account: AccountExecutions) -> Projection:
    """Project long-only FIFO. Unknown fees never silently become zero.

    Costs/P&L are in each instrument's own verified native currency. A
    provider-position snapshot (different as-of time) cannot fill history gaps.
    This function deliberately cannot calculate unrealized P&L or FX returns.
    """
    if not isinstance(account.workspace_id, UUID) or not isinstance(account.account_id, UUID):
        raise TypeError("Trusted server-resolved workspace and account UUIDs required")
    if not account.history_covered or not account.corporate_actions_reconciled:
        return Projection("UNAVAILABLE", (), ("COVERAGE_NOT_VERIFIED",))
    by_id = {}
    for fill in account.executions:
        if not isinstance(fill.source_id, str) or not fill.source_id.strip() or len(fill.source_id)>256:
            return Projection("UNAVAILABLE", (), ("INVALID_SOURCE_ID",))
        existing = by_id.get(fill.source_id)
        if existing is not None:
            if existing != fill:
                return Projection("UNAVAILABLE", (), ("CONFLICTING_SOURCE_VERSION",))
            continue
        by_id[fill.source_id] = fill
        if (not _SYMBOL.fullmatch(fill.symbol) or fill.side not in ("BUY", "SELL")
                or not _CURRENCY.fullmatch(fill.currency)
                or not _amount(fill.quantity, positive=True)
                or not _amount(fill.price, positive=True)
                or not isinstance(fill.occurred_at, datetime)
                or fill.occurred_at.tzinfo is None
                or fill.occurred_at.utcoffset() is None
                or (fill.fee is not None and not _amount(fill.fee))
                or (fill.fee is not None and fill.fee_currency != fill.currency)
                or (fill.fee is None and fill.fee_currency is not None)):
            return Projection("UNAVAILABLE", (), ("UNVERIFIED_EXECUTION",))
    # Repeated timestamps for the same ticker can alter FIFO cost attribution.
    stamps = set()
    for fill in by_id.values():
        key = (fill.symbol, fill.currency, fill.occurred_at.astimezone(timezone.utc))
        if key in stamps:
            return Projection("UNAVAILABLE", (), ("AMBIGUOUS_FILL_SEQUENCE",))
        stamps.add(key)
    ordered = sorted(by_id.values(), key=lambda f: f.occurred_at.astimezone(timezone.utc))
    # Mutable working lots = [remaining, fee-inclusive unit cost (or None)].
    lots: dict[tuple[str,str], list[list]] = {}
    realized: dict[tuple[str,str], Decimal | None] = {}
    issues: set[str] = set()
    for fill in ordered:
        key = (fill.symbol, fill.currency)
        queue = lots.setdefault(key, [])
        realized.setdefault(key, Decimal(0))
        if fill.side == "BUY":
            unit_cost = (fill.price + fill.fee / fill.quantity) if fill.fee is not None else None
            if unit_cost is None:
                issues.add("FEE_UNKNOWN")
            queue.append([fill.quantity, unit_cost])
            continue
        available = sum((lot[0] for lot in queue), Decimal(0))
        if available < fill.quantity:
            return Projection("UNAVAILABLE", (), ("INSUFFICIENT_OPEN_LOTS",))
        remaining = fill.quantity
        sale_fee_unit = fill.fee / fill.quantity if fill.fee is not None else None
        if sale_fee_unit is None:
            issues.add("FEE_UNKNOWN")
        while remaining:
            lot = queue[0]
            used = min(lot[0], remaining)
            if lot[1] is None or sale_fee_unit is None:
                realized[key] = None
                issues.add("FEE_UNKNOWN")
            elif realized[key] is not None:
                realized[key] += used * (fill.price - sale_fee_unit - lot[1])
            lot[0] -= used
            remaining -= used
            if not lot[0]:
                queue.pop(0)
    positions = []
    for key in sorted(lots):
        quantity = sum((lot[0] for lot in lots[key]), Decimal(0))
        unit_costs = [lot[0] * lot[1] if lot[1] is not None else None for lot in lots[key]]
        cost_basis = sum(unit_costs, Decimal(0)) if all(v is not None for v in unit_costs) else None
        positions.append(NativePosition(key[0],key[1],quantity,cost_basis,realized[key]))
    return Projection("REVIEW_REQUIRED" if issues else "CALCULATED",
                      tuple(positions),tuple(sorted(issues)))
