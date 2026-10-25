"""S2 manual trade input, accounting fidelity and fail-closed validation."""
import copy
import unittest
from uuid import uuid4

from services.saas_api.trades import TradeInputError, normalize_trade, _digest


def trade():
    return {
        "idempotencyKey": str(uuid4()), "kind": "EXECUTION", "confirm": True,
        "ticker": "RKLB", "side": "BUY", "quantity": "1.250000000001",
        "price": "52.09", "currency": "USD", "fee": None,
        "executedAt": "2026-10-25T08:10:21-04:00",
        "rationale": "Technical support, explicit user statement",
    }


class TradePolicyTests(unittest.TestCase):
    def test_valid_manual_execution_preserves_decimal_fee_and_time(self):
        out = normalize_trade(trade())
        self.assertEqual(out["quantity"], "1.250000000001")
        self.assertEqual(out["fee"], None)
        self.assertEqual(out["executedAt"], "2026-10-25T08:10:21-04:00")
        self.assertEqual(out["kind"], "EXECUTION")

    def test_dedupe_hash_stable_for_same_ordered_content(self):
        x = trade()
        self.assertEqual(_digest(normalize_trade(x)), _digest(normalize_trade(dict(reversed(list(x.items()))))))

    def test_invalid_tenant_and_financial_values_are_rejected(self):
        base = trade()
        overrides = [
            {"workspaceId": "malicious"}, {"accountId": "malicious"},
            {"authorUserId": "malicious"}, {"confirm": "true"},
            {"confirm": False}, {"idempotencyKey": "bad"},
            {"ticker": "rklb"}, {"ticker": "RKLB;DROP TABLE"}, {"side": "SHORT"},
            {"quantity": "0"}, {"quantity": "-1"}, {"quantity": "nan"},
            {"quantity": "1.0000000000001"}, {"quantity": 0.5},
            {"price": "0"}, {"price": "1e4"}, {"price": "1000000000000000000"},
            {"currency": "usd"}, {"currency": "EURO"}, {"fee": "-1"},
            {"executedAt": "2026-10-25T08:10:21"},
            {"executedAt": "2026-10-25"}, {"executedAt": "not a date"},
            {"rationale": "x" * 3001}, {"kind": "REVERSAL"},
        ]
        for changes in overrides:
            with self.subTest(changes=repr(changes)[:90]):
                with self.assertRaises(TradeInputError):
                    normalize_trade({**base, **changes})

    def test_void_requires_reason_and_exact_target(self):
        base = {"kind": "VOID", "idempotencyKey": str(uuid4()), "confirm": True,
                "voidsEventId": str(uuid4()), "rationale": "Duplicated import"}
        out = normalize_trade(base)
        self.assertEqual(out["kind"], "VOID")
        self.assertEqual(out["rationale"], "Duplicated import")
        for updates in [{"voidsEventId": "bad"}, {"ticker": "TSLA"},
                        {"rationale": ""}, {"confirm": False}]:
            with self.subTest(updates=updates):
                with self.assertRaises(TradeInputError):
                    normalize_trade({**base, **updates})


if __name__ == "__main__":
    unittest.main()
