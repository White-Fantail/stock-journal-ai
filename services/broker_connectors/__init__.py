"""Tenant-scoped, read-only brokerage integration contracts (S2 scaffold).

This package never initializes credentials, brokers, trading APIs or web routes.
"""
from .contracts import (
    BrokerAdapter, BrokerDescriptor, BrokerFill, BrokerPosition,
    BrokerSyncBatch, BrokerSyncRequest, BrokerUnavailable, SyncWindow,
)
from .registry import available_providers, provider_descriptor

__all__ = [
    "BrokerAdapter", "BrokerDescriptor", "BrokerFill", "BrokerPosition",
    "BrokerSyncBatch", "BrokerSyncRequest", "BrokerUnavailable",
    "SyncWindow", "available_providers", "provider_descriptor",
]
