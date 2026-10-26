"""Offline regression: Tiger personal history never becomes verified fills."""
import os
import unittest
from datetime import datetime,timezone
from types import SimpleNamespace
from unittest.mock import patch
from temporary.tiger_personal.history import _payload, _display_filled, load_orders, PilotError
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
            filled=4,filled_scale=0,avg_fill_price=12.5,commission=1.25,trade_time=1764547200000,
            contract=SimpleNamespace(symbol="TSLA",currency="USD"))
        data=_order(o,"12345678")
        self.assertEqual(data["filled"],"4")
        self.assertEqual(data["filledScale"],0)
        self.assertEqual(data["status"],"FILLED")
        self.assertNotIn("executedAtUtc",data)
        with self.assertRaises(ValueError): _order(o,"11111111")

    def test_fractional_filled_quantity_exact_scale(self):
        order=SimpleNamespace(account="12345678",id=222,action="BUY",status="FILLED",
            filled=179211,filled_scale=3,avg_fill_price=16.74,commission=2.01,
            trade_time=1764547200000,contract=SimpleNamespace(symbol="PLTR",currency="USD"))
        raw=_order(order,"12345678")
        self.assertEqual(raw["filled"],"179211")
        self.assertEqual(raw["filledScale"],3)
        self.assertEqual(_display_filled(raw),"179.211")
        self.assertEqual(_display_filled({"filled":"12345678901","filledScale":5}),"123,456.78901".replace(",",""))
        self.assertIsNone(_display_filled({"filled":"179211"}))
        self.assertEqual(_display_filled({"filled":"0"}),"0")
        with patch.dict(os.environ,_ENV,clear=True):
            request=self.example()
            request["orders"]=[{**request["orders"][0],**{"filled":"179211","filledScale":3}}]
            self.assertEqual(_payload(request)[-1][0]["filledScale"],3)
            request["orders"][0]["filledScale"]=13
            with self.assertRaises(PilotError): _payload(request)
        order.filled_scale=None
        with self.assertRaises(ValueError): _order(order,"12345678")


    def test_legacy_471_orders_survive_schema_expansion_without_reimport(self):
        """Historic encrypted order evidence has neither feeCurrency nor filledScale."""
        from temporary.tiger_personal import history
        class ReadOnlyBroker:
            def __init__(self, rows):
                self.rows=rows
                self.queries=[]
            def execute(self, sql, args):
                self.queries.append(sql)
                if not sql.lstrip().startswith("SELECT "):
                    raise AssertionError("history read must never mutate stored snapshots")
                return SimpleNamespace(fetchall=lambda:self.rows)

        docs=[]
        for start in range(0,471,25):
            orders=[{"id":str(i+1),"symbol":"TEST","currency":"USD",
                     "side":"BUY","status":"FILLED","filled":"179211",
                     "price":"1.25","fee":"0.4","at":"1764547200000"}
                    for i in range(start,min(start+25,471))]
            docs.append({"source":"PERSONAL_ORDER_OBSERVATION",
                         "from":str(1764547200000+start*1000),
                         "to":str(1767139200000+start*1000),
                         "complete":True,"orders":orders})
        # Returned rows are newest first; the sealed payloads are untouched.
        broker=ReadOnlyBroker([(i,) for i in range(len(docs))])
        def decrypt(index,aad):
            self.assertEqual(aad,"workspace:account:TRANSACTIONS")
            return docs[index]
        with patch.object(history,"unseal",side_effect=decrypt):
            first=load_orders(broker,"workspace","account")
            second=load_orders(broker,"workspace","account",page=1)
        self.assertEqual(first["totalOrders"],471)
        self.assertTrue(first["hasMore"])
        self.assertEqual(len(first["orders"]),100)
        self.assertEqual(len(second["orders"]),100)
        self.assertTrue(all(o["feeCurrency"] is None for o in first["orders"]))
        self.assertTrue(all(o["filled"] is None for o in first["orders"]))
        self.assertTrue(all(o["sourceRef"] and len(o["sourceRef"])==64 for o in first["orders"]))
        self.assertEqual(len(broker.queries),2)

    def test_recent_order_keeps_documented_fee_currency_and_scaled_quantity(self):
        from temporary.tiger_personal import history
        doc={"source":"PERSONAL_ORDER_OBSERVATION","from":"1764547200000",
             "to":"1767139200000","complete":True,
             "orders":[{"id":"200","symbol":"TEST","currency":"USD","side":"BUY",
                        "status":"FILLED","filled":"179211","filledScale":3,
                        "price":"12.5","fee":"0.25","feeCurrency":"USD",
                        "at":"1764547200000"}]}
        class Broker:
            def execute(self,sql,args):
                return SimpleNamespace(fetchall=lambda:[("encrypted",)])
        with patch.object(history,"unseal",return_value=doc):
            response=load_orders(Broker(),"workspace","account")
        self.assertEqual(response["orders"][0]["feeCurrency"],"USD")
        self.assertEqual(response["orders"][0]["filled"],"179.211")

    def test_capped_page_without_cursor_is_partial(self):
        def order(i):
            return SimpleNamespace(account="12345678",id=i,action="BUY",
                status="FILLED",filled=1,filled_scale=0,avg_fill_price=2,commission=None,
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
