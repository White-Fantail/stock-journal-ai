"""Offline-only multi-broker contract checks (no Tiger credentials/network)."""
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from uuid import uuid4
import unittest

from services.broker_connectors import (
    BrokerSyncRequest, BrokerUnavailable, SyncWindow, available_providers,
    provider_descriptor,
)
from services.broker_connectors.tiger import TigerAdapter
from services.tiger_sync.adapters import FixtureAdapter

NOW = datetime(2026, 10, 20, tzinfo=timezone.utc)


def request():
    return BrokerSyncRequest(uuid4(), uuid4(), uuid4(),
                             SyncWindow(NOW, NOW + timedelta(days=1)))


def fixture():
    order = {"id": "synthetic-order-1",
             "contract": {"symbol": "TSLA", "currency": "USD"},
             "action": "BUY", "filled": 125, "filled_scale": 2,
             "avg_fill_price": "200", "trade_time": "2026-10-20T10:00:00Z"}
    fill = {"id": "synthetic-fill-1", "order_id": "synthetic-order-1",
            "contract": {"symbol": "TSLA", "currency": "USD"},
            "action": "BUY", "filled_quantity": 125,
            "filled_quantity_scale": 2, "filled_price": "200",
            "transacted_at": "2026-10-20T10:00:00Z"}
    return {
        "orders": {"": {"result": [order], "next_page_token": None}},
        "transactions": {"synthetic-order-1": {"": {
            "result": [fill], "next_page_token": None
        }}},
        "positions": [{"contract": {"symbol": "TSLA", "currency": "USD"},
                       "position_qty": "1.25"}],
    }


class BrokerAdapterTests(unittest.TestCase):
    def test_tiger_is_unavailable_without_reviewed_worker(self):
        adapter = TigerAdapter()
        self.assertEqual(adapter.descriptor.state, "REQUIRES_REVIEW")
        with self.assertRaises(BrokerUnavailable):
            adapter.shadow_read(request())
        self.assertNotIn("TRADE_EXECUTION", adapter.descriptor.capabilities)

    def test_registry_is_closed_and_no_credentials(self):
        self.assertEqual([p.code for p in available_providers()], ["TIGER"])
        self.assertEqual(provider_descriptor("TIGER").name, "Tiger Brokers")
        for name in ("IBKR", "tiger", "../../etc/passwd", ""):
            with self.assertRaises(ValueError):
                provider_descriptor(name)

    def test_request_rejects_unscoped_ids_or_naive_dates(self):
        with self.assertRaises(TypeError):
            BrokerSyncRequest("tenant", uuid4(), uuid4(),
                              SyncWindow(NOW, NOW + timedelta(days=1)))
        with self.assertRaises(ValueError):
            SyncWindow(datetime(2026, 10, 20), NOW + timedelta(days=1))
        with self.assertRaises(ValueError):
            SyncWindow(NOW, NOW + timedelta(days=90))

    def test_tiger_wraps_existing_decimal_normalization_without_writes(self):
        req = request()
        batch = TigerAdapter(lambda scope: FixtureAdapter(fixture())).shadow_read(req)
        self.assertEqual(batch.request.workspace_id, req.workspace_id)
        self.assertEqual(batch.provider, "TIGER")
        self.assertEqual(batch.completeness, "COMPLETE")
        self.assertEqual(batch.order_count, 1)
        self.assertEqual(len(batch.fills), 1)
        self.assertEqual(batch.fills[0].quantity, Decimal("1.25"))
        self.assertEqual(batch.fills[0].fee_total, None)
        self.assertEqual(batch.fills[0].currency, "USD_UNVERIFIED")
        self.assertEqual(batch.positions[0].quantity, Decimal("1.25"))
        self.assertEqual(batch.issue_codes, ())


if __name__ == "__main__":
    unittest.main()
