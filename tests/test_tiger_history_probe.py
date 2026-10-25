"""Synthetic response-only contract checks; never send live Tiger requests."""
import unittest
from services.broker_connectors.tiger_history_probe import (
    ProbeRejected,inspect_response_shape,transaction_inquiry,
)

class TigerHistoryProbeTests(unittest.TestCase):
    def test_documented_inquiry_is_read_only_but_not_paginated(self):
        spec=transaction_inquiry("ABCDE12345",order_id="123456789",limit=100)
        self.assertEqual(spec.path,"/api/v1/orders/transactions")
        self.assertEqual(dict(spec.params),{"accountId":"ABCDE12345",
                                          "orderId":"123456789","limit":"100"})
        self.assertEqual(spec.mandatory_headers,("Authorization","X-TIGR-UID"))
        self.assertEqual(spec.historical_coverage,"UNVERIFIED")
        self.assertFalse(spec.supports_resumable_cursor)

    def test_query_rejects_non_documented_controls(self):
        for account in ("","a"," ../secret","test?x=1"):
            with self.assertRaises(ProbeRejected):
                transaction_inquiry(account)
        for limit in (0,101,False,"100",1.2):
            with self.assertRaises(ProbeRejected):
                transaction_inquiry("ABCDE12345",limit=limit)
        for order in ("-1","7 or 1=1","",99):
            with self.assertRaises(ProbeRejected):
                transaction_inquiry("ABCDE12345",order_id=order)

    def test_shape_probe_never_turns_response_into_fills(self):
        for envelope in ({"code":0,"data":[]},{"code":200,"data":{"unknown":"no mapping"}},
                         {"code":"0","data":[]}):
            result=inspect_response_shape(envelope)
            self.assertEqual(result["historicalCoverage"],"UNVERIFIED")
            self.assertFalse(result["publishable"])
            self.assertEqual(result["mapping"],"UNVERIFIED")
            self.assertEqual(result["pagination"],"UNVERIFIED")

    def test_malformed_and_error_responses_fail_closed(self):
        for response in ({},[],{"code":0},{"code":401,"data":[]},
                         {"code":0,"data":None},{"code":0,"data":"a"},
                         {"code":0,"data":list(range(101))},
                         {"code":True,"data":[]}):
            with self.subTest(response=type(response).__name__):
                with self.assertRaises(ProbeRejected):
                    inspect_response_shape(response)

if __name__=="__main__":
    unittest.main()
