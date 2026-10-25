# Split from original Phase 2 shadow collector with unchanged behavior.
# No Tiger credentials, network client creation or canonical ledger writes.
from __future__ import annotations

import hashlib
import json

MAX_DAYS = 89
MAX_PAGES = 50
ORDER_PAGE_LIMIT = 100
FILL_PAGE_LIMIT = 100
READ_METHODS = frozenset({"get_orders", "get_transactions", "get_positions"})


class ShadowFailure(ValueError):
    pass


class UnsupportedTransactions(ShadowFailure):
    """Official Tiger API limits detailed get_transactions to Prime/Paper."""


class IncompletePage(ShadowFailure):
    pass


def field(obj, name, default=None):
    return obj.get(name, default) if isinstance(obj, dict) else getattr(obj, name, default)

def canonical(data: dict) -> str:
    return json.dumps(data, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def checksum(data: dict) -> str:
    return hashlib.sha256(canonical(data).encode("utf-8")).hexdigest()


