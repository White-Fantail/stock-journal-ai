import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from temporary.tiger_personal import api, runner, sync_ready

class PilotUnitTests(unittest.TestCase):
    def test_disabled_by_default(self):
        with patch.dict(os.environ,{},clear=True):
            with self.assertRaises(api.PilotError):
                api.owner_only("123456789")

    def test_owner_and_snapshot(self):
        env={"POSITIONARY_PERSONAL_TIGER_ENABLED":"1","POSITIONARY_PERSONAL_GOOGLE_SUBJECT":"123456789"}
        with patch.dict(os.environ,env,clear=True):
            data={"subject":"123456789","account":"U12345678",
                  "assets":{"netLiquidation":"100","cashBalance":None},
                  "positions":[{"symbol":"TSLA","currency":"USD","quantity":"1.5",
                    "averageCost":"12","marketValue":None,"unrealizedPnl":None}]}
            a,_,p=api.verify_payload(data)
            self.assertEqual(a,"U12345678")
            self.assertEqual(p[0]["quantity"],"1.5")
            for n in ("NaN","Infinity","1e4","1.1234567890123"):
                with self.assertRaises(api.PilotError):
                    api.verify_payload({**data,"positions":[{**p[0],"quantity":n}]})
            with self.assertRaises(api.PilotError):
                api.verify_payload({**data,"subject":"999999999"})

    def test_https_destination_is_pinned(self):
        base="https://positionary-api-production.up.railway.app"
        self.assertEqual(sync_ready._endpoint({"POSITIONARY_PERSONAL_BRIDGE_URL":base}),base)
        for host in ("http://example.com","https://evil.example",
                     base+".evil.com",base+"/other"):
            with self.assertRaises(ValueError):
                sync_ready._endpoint({"POSITIONARY_PERSONAL_BRIDGE_URL":host})

    def test_read_query_methods_only(self):
        class Fake:
            def get_assets(self,account): return [SimpleNamespace(summary=SimpleNamespace(net_liquidation=23.2,cash_balance=None))]
            def get_positions(self,account):
                return [SimpleNamespace(contract=SimpleNamespace(symbol="TSLA",currency="USD"),
                  position_qty=1.5,average_cost=12,market_value=None,unrealized_pnl=None)]
            def place_order(self,*args): raise AssertionError("not allowed")
        obj=Fake()
        self.assertEqual(runner.read_only_snapshot(obj,"U12345678"),1)
        assets,positions=sync_ready.normalize(obj.get_assets("U12345678"),obj.get_positions("U12345678"))
        self.assertEqual(assets["netLiquidation"],"23.2")
        self.assertEqual(positions[0]["quantity"],"1.5")

if __name__=="__main__":
    unittest.main()
