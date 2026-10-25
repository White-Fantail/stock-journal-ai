"""Pure input-security checks for P1/P2 (all data synthetic)."""
import unittest
from services.saas_api.journal import normalize_note
from services.saas_api.trades import TradeInputError
from services.saas_api.request_security import valid_nonce


class JournalInputTests(unittest.TestCase):
    def test_journal_record_accepts_normalized_events(self):
        valid={"idempotencyKey":"00000000-0000-4000-8000-000000000001",
               "kind":"THESIS","ticker":"TSLA","content":" Synthetic long-term thesis ",
               "tradeEventId":None}
        result=normalize_note(valid)
        self.assertEqual(result["content"],"Synthetic long-term thesis")
        self.assertEqual(result["kind"],"THESIS")
        self.assertEqual(normalize_note({**valid,"kind":"WATCHLIST_ADD","content":""})["content"],"")
        for changed in (
            {"ticker":"../etc/passwd"}, {"content":""}, {"kind":"UNKNOWN"},
            {"workspace_id":"forged"}, {"tradeEventId":"other-tenant"},
            {"kind":"WATCHLIST_REMOVE","content":"something"},
            {"kind":"THESIS","tradeEventId":"00000000-0000-4000-8000-000000000012"},
            {"content":"x"*6001}, {"idempotencyKey":"no"},
        ):
            with self.subTest(changed=changed), self.assertRaises(TradeInputError):
                normalize_note({**valid,**changed})

    def test_hmac_nonce_is_unique_request_identity(self):
        self.assertTrue(valid_nonce("8d4b10bc-b1c3-4a12-a0d2-000000000001"))
        for value in ("", "not-a-uuid", "a"*36, "00000000-0000-0000-0000-000000000000", None):
            self.assertFalse(valid_nonce(value))


if __name__=="__main__":
    unittest.main()
