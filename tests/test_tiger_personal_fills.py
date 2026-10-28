"""Synthetic-only Tiger personal individual transaction API contract tests."""
import os
import unittest
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from temporary.tiger_personal import fill_probe
from temporary.tiger_personal.api import PilotError

OWNER="1234567890"
ENV={"POSITIONARY_PERSONAL_TIGER_ENABLED":"1","POSITIONARY_PERSONAL_GOOGLE_SUBJECT":OWNER}
ORDER={"id":"41234","symbol":"TSLA","currency":"USD","side":"BUY",
       "filled":"1250","filledScale":3,"fee":"1.25","feeCurrency":None,"at":"1764547200000"}


def transaction(ident="55501", order="41234", raw=1250, scale=3, account="12345678"):
    return SimpleNamespace(
        id=int(ident), order_id=int(order), account=account,
        contract=SimpleNamespace(symbol="TSLA", currency="USD"),
        action="BUY", filled_quantity=raw, filled_quantity_scale=scale,
        filled_price=124.5, transacted_at="2025-12-01 12:00:00")


def response(rows, token=None):
    return SimpleNamespace(result=rows,next_page_token=token)


class TigerPersonalFillProbeTests(unittest.TestCase):
    def test_exact_fractional_quantity_and_source_time_unassigned(self):
        x=fill_probe._transaction(transaction(),"12345678",ORDER)
        self.assertEqual(x["quantity"],"1.25")
        self.assertEqual(x["price"],"124.5")
        self.assertEqual(x["timeRaw"],"2025-12-01 12:00:00")
        self.assertNotIn("timezone",x)
        self.assertNotIn("fee",x)

    def test_mismatched_account_order_security_and_scale(self):
        examples=[
            transaction(account="12345679"),
            transaction(order="999"),
            transaction(scale=None),
            transaction(scale=13),
            transaction(raw=1.5),
        ]
        for item in examples:
            with self.subTest(item=item):
                with self.assertRaises(ValueError):
                    fill_probe._transaction(item,"12345678",ORDER)

    def test_readonly_uses_order_bound_query_and_detects_exact_sum(self):
        class Client:
            def __init__(self): self.queries=[]
            def get_transactions(self,**kwargs):
                self.queries.append(kwargs)
                if len(self.queries)==1:
                    return response([transaction("55501",raw=750)],"next")
                return response([transaction("55502",raw=500)])
            def place_order(self,*args,**kwargs):
                raise AssertionError("Trading forbidden")
        c=Client()
        p=fill_probe._probe_order(c,"12345678",ORDER)
        self.assertEqual(p["status"],"OBSERVED")
        self.assertEqual(sum(Decimal(f["quantity"]) for f in p["fills"]),Decimal("1.25"))
        self.assertEqual(p["orderCommission"],"1.25")
        self.assertIsNone(p["commissionCurrency"])
        self.assertEqual([x["page_token"] for x in c.queries],["","next"])
        self.assertTrue(all(x["account"]=="12345678" and x["order_id"]==41234 for x in c.queries))

    def test_partial_and_unsupported_fail_closed(self):
        class Missing:
            def get_transactions(self,**kwargs): raise RuntimeError("SECRET_ACCOUNT_NUMBER")
        self.assertEqual(fill_probe._probe_order(Missing(),"12345678",ORDER)["status"],"UNAVAILABLE")
        class Different:
            def get_transactions(self,**kwargs): return response([transaction(raw=250)])
        self.assertEqual(fill_probe._probe_order(Different(),"12345678",ORDER)["status"],"DIFFERENCE")
        class Loop:
            def get_transactions(self,**kwargs): return response([transaction()],"repeated")
        self.assertEqual(fill_probe._probe_order(Loop(),"12345678",ORDER)["status"],"PARTIAL")

    def test_read_projection_links_fills_to_parent_order_without_exposing_order_id(self):
        import hashlib
        class Broker:
            def execute(self, sql, params):
                return SimpleNamespace(fetchall=lambda: [(b"synthetic-encrypted",)])
        doc={"source":"PERSONAL_TRANSACTION_OBSERVATION",
             "probes":[{"orderId":"41234","symbol":"TSLA",
                        "fills":[fill_probe._transaction(transaction(),"12345678",ORDER)],
                        "status":"OBSERVED"}]}
        with patch("temporary.tiger_personal.fill_probe.unseal",return_value=doc):
            result=fill_probe.load_probes(Broker(),"workspace","synthetic-account")
        observed=result["fillObservations"]
        self.assertEqual(len(observed),1)
        self.assertEqual(observed[0]["orderSourceRef"],
                         hashlib.sha256(b"synthetic-account:41234").hexdigest())
        self.assertNotIn("orderId",observed[0])
        self.assertEqual(observed[0]["quantity"],"1.25")

    def test_ingress_does_not_promote_unverified_to_ledger(self):
        doc={"subject":OWNER,"account":"12345678","from":"1764547200000","to":"1767139200000",
             "probes":[{**{k:ORDER[k] for k in ("symbol","currency","side")},
               "orderId":ORDER["id"],"orderCommission":"1.25","commissionCurrency":None,
               "status":"OBSERVED","fills":[fill_probe._transaction(transaction(),"12345678",ORDER)]}]}
        with patch.dict(os.environ,ENV,clear=True):
            self.assertEqual(fill_probe._payload(doc)[0],"12345678")
            violations=[
                {**doc,"subject":"9999999999"},
                {**doc,"workspaceId":"foreign"},
                {**doc,"probes":[{**doc["probes"][0],"status":"VERIFIED"}]},
                {**doc,"probes":[{**doc["probes"][0],"fills":[{**doc["probes"][0]["fills"][0],"orderId":"999"}]}]},
                {**doc,"probes":[doc["probes"][0],doc["probes"][0]]},
                {**doc,"probes":[{**doc["probes"][0],"tradeAction":"PLACE"}]},
                {**doc,"probes":[{**doc["probes"][0],"commissionCurrency":"bad"}]},
            ]
            for bad in violations:
                with self.subTest(bad=bad):
                    with self.assertRaises(PilotError):
                        fill_probe._payload(bad)
        with patch.dict(os.environ,{},clear=True):
            with self.assertRaises(PilotError):
                fill_probe._payload(doc)


if __name__=="__main__":
    unittest.main()
