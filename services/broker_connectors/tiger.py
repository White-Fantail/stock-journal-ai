"""Tiger read-only adapter over the proven legacy Phase 2 offline collector.

This deliberately does NOT implement OAuth, a token cache, credential lookup,
or production TradeClient construction. An externally reviewed worker may later
supply a narrowly permissioned read-only source factory after tenant ownership,
account grant, and SDK token persistence have been verified.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Callable

from .contracts import (
    BrokerAdapter, BrokerDescriptor, BrokerFill, BrokerPosition,
    BrokerSyncBatch, BrokerSyncRequest, BrokerUnavailable,
)
from services.tiger_sync.collector import collect

TIGER_DESCRIPTOR = BrokerDescriptor(
    code="TIGER", name="Tiger Brokers", state="REQUIRES_REVIEW",
    auth_modes=("OAUTH2_RETAIL_PENDING_APPROVAL",),
    capabilities=("POSITIONS", "ORDERS", "EXECUTIONS"),
)


class TigerAdapter(BrokerAdapter):
    """Explicit factory injection is for offline fixtures / future trusted worker.

    No factory means broker access is unavailable, regardless of local env.
    """
    def __init__(self, read_source_factory: Callable[[BrokerSyncRequest], object] | None = None):
        self._factory = read_source_factory

    @property
    def descriptor(self) -> BrokerDescriptor:
        return TIGER_DESCRIPTOR

    def shadow_read(self, request: BrokerSyncRequest) -> BrokerSyncBatch:
        if self._factory is None:
            raise BrokerUnavailable("Tiger OAuth/third-party connection not enabled")
        source = self._factory(request)
        # Reuse bounded pagination, transaction/fee validation and Decimal scale
        # handling from Phase 2. No database writes or SDK construction.
        outcome = collect(source, request.window.start_utc, request.window.end_utc)
        fills = []
        for _, record in outcome["records"]["FILL"]:
            raw_time = record["time_utc"]
            when = datetime.fromisoformat(raw_time) if raw_time else None
            fills.append(BrokerFill(
                provider_fill_id=record["fill_id"],
                provider_order_id=record["order_id"],
                symbol=record["ticker"],
                side=record["side"],
                quantity=Decimal(record["quantity"]),
                price=Decimal(record["price"]),
                # Phase 2 explicitly cannot verify the contract's currency.
                currency=record["unit"],
                executed_at_utc=when,
                time_confidence=record["time_confidence"],
                fee_total=None,
                source_time_raw=record["time_raw"],
            ))
        positions = tuple(BrokerPosition(
            symbol=p["ticker"], quantity=Decimal(p["quantity"]),
            currency=p["currency"],
        ) for _, p in outcome["records"]["POSITION"])
        return BrokerSyncBatch(
            request=request, provider=self.descriptor.code,
            completeness=outcome["status"], fills=tuple(fills), positions=positions,
            order_count=len(outcome["records"]["ORDER"]),
            issue_codes=tuple(sorted({code for code, _, _ in outcome["issues"]})),
        )
