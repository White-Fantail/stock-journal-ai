"""Closed, static registry: no arbitrary user-controlled module imports."""
from __future__ import annotations

from .contracts import BrokerDescriptor
from .tiger import TIGER_DESCRIPTOR

# Future providers (e.g. IBKR) must pass explicit legal/auth review before
# registration. Manual trade entry belongs to the journal service; no CSV importer.
_PROVIDERS: dict[str, BrokerDescriptor] = {
    "TIGER": TIGER_DESCRIPTOR,
}


def available_providers() -> tuple[BrokerDescriptor, ...]:
    return tuple(_PROVIDERS.values())


def provider_descriptor(code: str) -> BrokerDescriptor:
    # Only a known provider identifier is allowed. Never dynamic import.
    try:
        return _PROVIDERS[code]
    except KeyError:
        raise ValueError("Unsupported broker provider") from None
