"""Offline P2 plan annotation validation, never an executable brokerage order."""
import unittest
from services.saas_api.journal_plans import normalize_plan
from services.saas_api.trades import TradeInputError

BASE={
 "idempotencyKey":"00000000-0000-4000-8000-000000000001",
 "ticker":"TEST","targetPrice":"123.45","stopPrice":"92.10",
 "priceCurrency":"USD","rationale":" Synthetic target/stop rationale ",
}
class JournalPlanInputTests(unittest.TestCase):
    def test_typed_revision_and_full_unset(self):
        entry=normalize_plan(BASE)
        self.assertEqual(entry["rationale"],"Synthetic target/stop rationale")
        self.assertEqual(entry["targetPrice"],"123.45")
        self.assertEqual(entry["stopPrice"],"92.10")
        clear=normalize_plan({**BASE,"targetPrice":None,"stopPrice":None,
                               "priceCurrency":None,"rationale":"Clear both levels"})
        self.assertIsNone(clear["targetPrice"])
        self.assertIsNone(clear["priceCurrency"])
        self.assertEqual(normalize_plan({**BASE,"stopPrice":None})["stopPrice"],None)

    def test_no_guessing_invalid_money_or_currency(self):
        invalid=[
            {"targetPrice":"NaN"},{"targetPrice":"Infinity"},{"targetPrice":"0"},
            {"targetPrice":"-1"},{"targetPrice":"01"},{"targetPrice":"1e4"},
            {"targetPrice":"1.0000000000001"},{"targetPrice":"9999999999999999999999999"},
            {"targetPrice":"1,000"},{"targetPrice":"1.2.3"},
            {"priceCurrency":"usd"},{"priceCurrency":"USDT"},
            {"priceCurrency":None},{"targetPrice":None,"stopPrice":None},
            {"rationale":" "},{"rationale":"x"*3001},
            {"ticker":"../../file"},{"ticker":"test"},
            {"idempotencyKey":"bad"},{"workspaceId":"another-tenant"},
        ]
        for change in invalid:
            with self.subTest(change=change),self.assertRaises(TradeInputError):
                normalize_plan({**BASE,**change})

    def test_malformed_optional_values_are_not_silently_erased(self):
        for value in (0,0.0,False,{},[],True):
            with self.subTest(value=value),self.assertRaises(TradeInputError):
                normalize_plan({**BASE,"stopPrice":value})
        with self.assertRaises(TradeInputError):
            normalize_plan({**BASE,"rationale":None})

if __name__=="__main__":
    unittest.main()
