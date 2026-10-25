# Split from original Phase 2 shadow collector with unchanged behavior.
# No Tiger credentials, network client creation or canonical ledger writes.
from __future__ import annotations

from .shared import ORDER_PAGE_LIMIT, FILL_PAGE_LIMIT, UnsupportedTransactions

class TigerReadOnlyAdapter:
    """Only explicitly whitelisted TradeClient methods are reachable.

    Build TradeClient + TigerOpenClientConfig in a separate, manually reviewed
    runner after credential rotation. This adapter never initializes secrets.
    """
    def __init__(self, trade_client, *, stock_type, us_market):
        self._client = trade_client
        self._stock_type = stock_type
        self._us_market = us_market

    def orders(self, start_ms, end_ms, token):
        return self._client.get_orders(
            sec_type=self._stock_type, market=self._us_market,
            start_time=start_ms, end_time=end_ms,
            limit=ORDER_PAGE_LIMIT, page_token=token)

    def transactions(self, order_id, token):
        return self._client.get_transactions(
            order_id=int(order_id), limit=FILL_PAGE_LIMIT, page_token=token)

    def positions(self):
        return self._client.get_positions(sec_type=self._stock_type, market=self._us_market)


class FixtureAdapter:
    """Synthetic fixture only; no network or credentials."""
    def __init__(self, contents):
        self._orders = contents["orders"]
        self._fills = contents["transactions"]
        self._positions = contents["positions"]
        self.transactions_available = contents.get("transactions_available", True)

    def orders(self, start_ms, end_ms, token):
        return self._orders[token]

    def transactions(self, order_id, token):
        if not self.transactions_available:
            raise UnsupportedTransactions("account does not support detailed transactions")
        return self._fills.get(str(order_id), {"result": [], "next_page_token": None})[token]

    def positions(self):
        return self._positions
