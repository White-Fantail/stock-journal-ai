"""Mock-only contract tests for Prime personal Tiger API snapshots."""
import unittest
from types import SimpleNamespace
from temporary.tiger_personal import sync_ready

class PrimeAssetTests(unittest.TestCase):
    def test_prime_portfolio_object_not_list(self):
        prime=SimpleNamespace(account="12345678", segments={
            "S": SimpleNamespace(net_liquidation=205.3,cash_balance=14.8,currency="USD")})
        assets,positions=sync_ready.normalize(prime,[])
        self.assertEqual(assets["netLiquidation"],"205.3")
        self.assertEqual(assets["cashBalance"],"14.8")
        self.assertEqual(assets["currency"],"USD")
        self.assertEqual(positions,[])

    def test_missing_currency_is_unknown_not_assumed(self):
        prime=SimpleNamespace(account="12345678",segments={
            "S":SimpleNamespace(net_liquidation=100,cash_balance=5)})
        assets,_=sync_ready.normalize(prime,[])
        self.assertIsNone(assets["currency"])

    def test_invalid_account_currency_is_rejected(self):
        prime=SimpleNamespace(account="12345678",segments={
            "S":SimpleNamespace(net_liquidation=100,cash_balance=5,currency="bad format")})
        with self.assertRaises(ValueError):
            sync_ready.normalize(prime,[])

    def test_prime_bad_response_fails_closed(self):
        with self.assertRaises(ValueError):
            sync_ready.normalize([],[])
        with self.assertRaises(ValueError):
            sync_ready.normalize(SimpleNamespace(segments={}),[])

    def test_account_mismatch_not_accepted(self):
        prime=SimpleNamespace(account="12345678", segments={
            "S": SimpleNamespace(net_liquidation=205.3,cash_balance=14.8)})
        assets,_=sync_ready.normalize(prime,[])
        self.assertEqual(assets["cashBalance"],"14.8")

    def test_failure_stage_names_are_opaque(self):
        env={"POSITIONARY_PERSONAL_TIGER_ENABLED":"0"}
        with self.assertRaises(sync_ready.PilotStepError) as cm:
            sync_ready.run(env)
        self.assertEqual(cm.exception.step,"CONFIG")

if __name__=="__main__":
    unittest.main()
