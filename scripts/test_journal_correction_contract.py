"""Regression checks for the existing append-only journal contract.

Correction endpoints must preserve this behavior when introduced.
"""
import unittest
from uuid import uuid4

from services.saas_api.journal import normalize_note
from services.saas_api.trades import TradeInputError


class JournalCorrectionContractTests(unittest.TestCase):
    def test_trade_reason_normalization_preserves_original_text(self):
        raw = {"idempotencyKey": str(uuid4()), "kind": "TRADE_NOTE",
               "ticker": "AAPL", "content": "  Original decision  ",
               "tradeEventId": None}
        normalized = normalize_note(raw)
        self.assertEqual(normalized["content"], "Original decision")
        self.assertEqual(normalized["kind"], "TRADE_NOTE")

    def test_correction_fields_cannot_be_smuggled_into_create(self):
        raw = {"idempotencyKey": str(uuid4()), "kind": "TRADE_NOTE",
               "ticker": "AAPL", "content": "Revised decision",
               "tradeEventId": None, "replacesJournalId": str(uuid4())}
        with self.assertRaises(TradeInputError):
            normalize_note(raw)

    def test_non_trade_note_cannot_attach_trade(self):
        raw = {"idempotencyKey": str(uuid4()), "kind": "REVIEW",
               "ticker": "AAPL", "content": "Review",
               "tradeEventId": str(uuid4())}
        with self.assertRaises(TradeInputError):
            normalize_note(raw)


if __name__ == "__main__":
    unittest.main()
