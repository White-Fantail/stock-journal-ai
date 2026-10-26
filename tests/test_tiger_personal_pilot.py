"""Synthetic checks: no live broker credentials, balances or orders."""
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from temporary.tiger_personal import api,runner,sync

OWNER="1234567890"
BASE={"POSITIONARY_PERSONAL_TIGER_ENABLED":"1",
      "POSITIONARY_PERSONAL_GOOGLE_SUBJECT":OWNER}
P={"symbol":"TSLA","currency":"USD","quantity":"2.5",
   "averageCost":"100.25","marketValue":None,"unrealizedPnl":None}

class PersonalPilotTests(unittest.TestCase):
    def test_owner_is_disabled_by_default(self):
        with patch.dict(os.environ,{},clear=True):
            with self.assertRaises(api.PilotError):
                api.owner_only(OWNER)
        with patch.dict(os.environ,BASE,clear=True):
            api.owner_only(OWNER)
            with self.assertRaises(api.PilotError):
                api.owner_only("9999999999")

    def test_validation_refuses_incomplete_or_untrusted_snapshots(self):
        with patch.dict(os.environ,BASE,clear=True):
            request={"subject":OWNER,"account":"U1234567","assets":{
                "netLiquidation":"50.5","cashBalance":None},"positions":[P]}
            account,assets,positions=api.verify_payload(request)
            self.assertEqual(account,"U1234567")
            self.assertEqual(assets["netLiquidation"],"50.5")
            self.assertEqual(positions[0]["quantity"],"2.5")
            for n in ["NaN","Infinity","1e6","1.0000000000001"]:
                with self.assertRaises(api.PilotError):
                    api.verify_payload({**request,"positions":[{**P,"quantity":n}]})
            with self.assertRaises(api.PilotError):
                api.verify_payload({**request,"positions":[P,P]})

    def test_private_destination_only(self):
        good="http://positionary-api.railway.internal:8080"
        self.assertEqual(sync._endpoint({"POSITIONARY_PERSONAL_BRIDGE_URL":good}),good)
        for bad in ("https://evil.example","http://positionary-apiXrailwayXinternal:8080",
                    good+"/redirect","http://127.0.0.1:8080"):
            with self.assertRaises(ValueError):
                sync._endpoint({"POSITIONARY_PERSONAL_BRIDGE_URL":bad})

    def test_collects_only_immutable_queries(self):
        class Client:
            def get_assets(self,account):
                return [SimpleNamespace(summary=SimpleNamespace(net_liquidation=12.5,cash_balance=None))]
            def get_positions(self,account):
                return [SimpleNamespace(contract=SimpleNamespace(symbol="TSLA",currency="USD"),
                    position_qty=2.5,average_cost=100.25,market_value=None,unrealized_pnl=None)]
            def place_order(self,*args):
                raise AssertionError("trading method must not be called")
        client=Client()
        self.assertEqual(runner.read_only_snapshot(client,"U1234567"),1)
        asset,rows=sync.normalize(client.get_assets("U1234567"),client.get_positions("U1234567"))
        self.assertEqual(asset["netLiquidation"],"12.5")
        self.assertEqual(rows[0]["quantity"],"2.5")

if __name__=="__main__":
    unittest.main()
