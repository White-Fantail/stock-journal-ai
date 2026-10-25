"""Broker-neutral immutable boundaries; all observations are shadow-only.

Callers MUST derive workspace and connection IDs from an authorized, tenant-bound
job in the server-side DB. Never accept these IDs as authority from the browser.
No placement/cancellation interfaces are defined anywhere in this package.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID


class BrokerUnavailable(RuntimeError):
    """Provider authorization or capability is not enabled; fail closed."""


@dataclass(frozen=True)
class BrokerDescriptor:
    code: str
    name: str
    state: str  # NOT_ENABLED, REQUIRES_REVIEW, ENABLED
    auth_modes: tuple[str, ...]
    capabilities: tuple[str, ...]
    # Descriptive only. A declared capability is NOT a verified live grant.


@dataclass(frozen=True)
class SyncWindow:
    start: datetime
    end: datetime

    def __post_init__(self) -> None:
        if (self.start.tzinfo is None or self.end.tzinfo is None
                or self.start.utcoffset() is None or self.end.utcoffset() is None):
            raise ValueError("Timezone-aware sync window required")
        if self.end <= self.start:
            raise ValueError("Sync window must be positive")
        if (self.end - self.start).total_seconds() > 89 * 86400:
            raise ValueError("Sync window exceeds safe 89-day bound")

    @property
    def start_utc(self) -> datetime:
        return self.start.astimezone(timezone.utc)

    @property
    def end_utc(self) -> datetime:
        return self.end.astimezone(timezone.utc)


@dataclass(frozen=True)
class BrokerSyncRequest:
    # Opaque internal IDs, not an externally provided account number or token.
    workspace_id: UUID
    connection_id: UUID
    account_id: UUID
    window: SyncWindow

    def __post_init__(self) -> None:
        if not all(isinstance(v, UUID) for v in (
            self.workspace_id, self.connection_id, self.account_id
        )):
            raise TypeError("Only validated internal UUID identities are accepted")


@dataclass(frozen=True)
class BrokerFill:
    provider_fill_id: str
    provider_order_id: str
    symbol: str
    side: str
    quantity: Decimal
    price: Decimal
    currency: str
    executed_at_utc: datetime | None
    time_confidence: str
    fee_total: Decimal | None  # None means UNKNOWN, never zero
    source_time_raw: str | None


@dataclass(frozen=True)
class BrokerPosition:
    symbol: str
    quantity: Decimal
    currency: str


@dataclass(frozen=True)
class BrokerSyncBatch:
    request: BrokerSyncRequest
    provider: str
    completeness: str  # COMPLETE or PARTIAL (not a user-ledger publication)
    fills: tuple[BrokerFill, ...]
    positions: tuple[BrokerPosition, ...]
    order_count: int
    issue_codes: tuple[str, ...]
    # No raw account identifiers, credentials or secret payloads.


class BrokerAdapter(ABC):
    @property
    @abstractmethod
    def descriptor(self) -> BrokerDescriptor:
        raise NotImplementedError

    @abstractmethod
    def shadow_read(self, request: BrokerSyncRequest) -> BrokerSyncBatch:
        """Read/query only. NEVER post ledger events or place orders."""
        raise NotImplementedError
