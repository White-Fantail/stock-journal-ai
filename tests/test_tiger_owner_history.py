"""Offline regression: Tiger personal history never becomes verified fills."""
import os
import unittest
from datetime import datetime,timezone
from types import SimpleNamespace
from unittest.mock import patch
from temporary.tiger_personal.history import _payload, PilotError
from temporary.tiger_personal.history_sync import _order, _pages
from temporary.tiger_personal.api import owner_only

_SUBJECT="1234567890"
_ENV={"POSITIONARY_PERSONAL_TIGER_ENABLED":"1","POSITIONARY_PERSONAL_GOOGLE_SUBJECT":_SUBJECT}

class TigerOwnerHistoryPolicy(unittest.TestCase):
    def example(self):
        return {"subject":_SUBJECT,"account":"12345678",
                "from":"1764547200000","to":"1767139200000",
                "part":0,"parts":1,"complete":True,
                "orders":[{"id":"123","symbol":"TSLA","currency":"USD",
                           "side":"BUY","status":"FILLED",
                           "filled":"2","price":"400","fee":None,"at":"1764547200000"}]}

    def test_only_owner_may_insert(self):
        with patch.dict(os.environ,_ENV,clear=True):
            val=self.example()
            self.assertEqual(_payload(val)[0],"12345678")
            with self.assertRaises(PilotError):
                _payload({**val,"subject":"9999999999"})
        with patch.dict(os.environ,{},clear=True):
            with self.assertRaises(PilotError):
                _payload(self.example())

    def test_reject_unknown_fields_and_injection(self):
        with patch.dict(os.environ,_ENV,clear=True):
            val=self.example()
            bad=[{**val,"tradingToken":"secret"},
                 {**val,"orders":[{**val["orders"][0],"order_type":"PLACE"}]},
                 {**val,"orders":[val["orders"][0],val["orders"][0]]},
                 {**val,"part":3,"parts":2},
                 {**val,"to":"1799999999999"}]
            for item in bad:
                with self.subTest(item=list(item.keys())):
                    with self.assertRaises(PilotError):
                        _payload(item)

    def test_order_observation_is_not_fill(self):
        o=SimpleNamespace(account="12345678",id=111,action="BUY",status="FILLED",
            filled=4,avg_fill_price=12.5,commission=1.25,trade_time=1764547200000,
            contract=SimpleNamespace(symbol="TSLA",currency="USD"))
        data=_order(o,"12345678")
        self.assertEqual(data["filled"],"4")
        self.assertEqual(data["status"],"FILLED")
        self.assertNotIn("executedAtUtc",data)
        with self.assertRaises(ValueError): _order(o,"11111111")

    def test_capped_page_without_cursor_is_partial(self):
        def order(i):
            return SimpleNamespace(account="12345678",id=i,action="BUY",
                status="FILLED",filled=1,avg_fill_price=2,commission=None,
                order_time=1764547200000,contract=SimpleNamespace(symbol="AAPL",currency="USD"))
        class Client:
            def get_orders(self,**kwargs):
                return [order(i) for i in range(1,101)]
        # Requires installed SDK in worker image; isolate fake module import.
        from unittest.mock import patch
        sec=SimpleNamespace(STK="STK")
        import sys
        with patch.dict(sys.modules,{"tigeropen.common.consts":SimpleNamespace(SecurityType=sec)}):
            rows,complete=_pages(Client(),"12345678",1764547200000,1767139200000)
        self.assertEqual(len(rows),100)
        self.assertFalse(complete)

if __name__=="__main__":
    unittest.main()
