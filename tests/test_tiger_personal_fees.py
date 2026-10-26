"""Synthetic Tiger show_charges read-only fee audit tests."""
import os
import unittest
from types import SimpleNamespace as NS
from unittest.mock import patch

from temporary.tiger_personal import fill_probe
from temporary.tiger_personal.api import PilotError

OWNER="1234567890"
ENV={"POSITIONARY_PERSONAL_TIGER_ENABLED":"1","POSITIONARY_PERSONAL_GOOGLE_SUBJECT":OWNER}
ORDER={"id":"41234","symbol":"TSLA","currency":"USD","side":"BUY",
       "filled":"1250","filledScale":3,"fee":"1.25","feeCurrency":None,"at":"1764547200000"}


def detail(currency=None,commission=1.25,charge_total=1.25):
    charges=[NS(category="TIGER",total=charge_total,details=[
        NS(type="USER_COMMISSION",after_discount_amount=1.00),
        NS(type="SETTLEMENT_FEE",after_discount_amount=0.25)])]
    return NS(id=41234,account="12345678",
              contract=NS(symbol="TSLA",currency="USD"),action="BUY",
              commission=commission,commission_currency=currency,charges=charges)


class FeeAuditTests(unittest.TestCase):
    def audit(self,entry):
        class Client:
            def __init__(self):self.calls=[]
            def get_order(self,**kwargs):self.calls.append(kwargs);return entry
            def place_order(self,*args,**kwargs):raise AssertionError("TRADING_FORBIDDEN")
        client=Client()
        result=fill_probe._fee_review(client,"12345678",ORDER)
        self.assertEqual(client.calls,[{"account":"12345678","id":41234,"show_charges":True}])
        return result

    def test_actual_order_fee_components_not_fill_allocations(self):
        result=self.audit(detail())
        self.assertEqual(result["status"],"CURRENCY_UNKNOWN")
        self.assertEqual(result["total"],"1.25")
        self.assertEqual(result["details"][0]["amount"],"1")
        self.assertEqual(len(result["details"]),2)
        self.assertNotIn("allocatedPerFill",result)
        self.assertEqual(self.audit(detail(currency="USD"))["status"],"MATCHED")

    def test_disagreement_and_missing_evidence_are_not_certified(self):
        self.assertEqual(self.audit(detail(commission=1.3))["status"],"DIFFERENCE")
        self.assertEqual(self.audit(detail(charge_total=1.3))["status"],"DIFFERENCE")
        self.assertEqual(self.audit(NS(**{**vars(detail()),"account":"other"}))["status"],"DIFFERENCE")
        self.assertEqual(self.audit(NS(**{**vars(detail()),"charges":None}))["status"],"UNAVAILABLE")

    def test_ingress_checks_breakdown_sum_and_currency(self):
        valid={"status":"CURRENCY_UNKNOWN","total":"1.25","currency":None,
               "details":[{"category":"TIGER","type":"USER_COMMISSION","amount":"1"},
                          {"category":"TIGER","type":"SETTLEMENT_FEE","amount":"0.25"}]}
        outer={"subject":OWNER,"account":"12345678",
               "from":"1764547200000","to":"1767139200000",
               "probes":[{"orderId":"41234","symbol":"TSLA","currency":"USD","side":"BUY",
                          "orderCommission":"1.25","commissionCurrency":None,
                          "status":"UNAVAILABLE","fills":[],"feeReview":valid}]}
        with patch.dict(os.environ,ENV,clear=True):
            self.assertEqual(fill_probe._payload(outer)[0],"12345678")
            invalid=[{**valid,"total":"1.30"},
                     {**valid,"currency":"USD"},
                     {**valid,"status":"MATCHED"},
                     {**valid,"status":"VERIFIED"},
                     {**valid,"details":[{**valid["details"][0],"amount":"1.2"},valid["details"][1]]},
                     {**valid,"details":[{**valid["details"][0],"type":"NOT SAFE"},valid["details"][1]]}]
            for row in invalid:
                with self.subTest(row=row):
                    with self.assertRaises(PilotError):
                        fill_probe._payload({**outer,"probes":[{**outer["probes"][0],"feeReview":row}]})


if __name__=="__main__":
    unittest.main()
