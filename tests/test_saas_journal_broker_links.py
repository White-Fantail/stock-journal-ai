"""P4 only an independently released fill may get an owner-authored note."""
import unittest
from unittest.mock import patch
from uuid import uuid4

from services.saas_api.journal_broker_links import (
    normalize_broker_note, _digest, create_broker_note,
)
from services.saas_api.trades import TradeInputError, TradeNotFound

def sample():
    return {"idempotencyKey":str(uuid4()),"ticker":"TEST","content":"A human-written test rationale",
            "accountId":str(uuid4()),"sourceRef":"a"*64}

class BrokerNoteInputTests(unittest.TestCase):
    def test_strict_normalization_and_idempotency_binding(self):
        item=sample()
        actual=normalize_broker_note({**item,"content":"  Memo  "})
        self.assertEqual(actual["content"],"Memo")
        self.assertEqual(actual["ticker"],"TEST")
        self.assertNotEqual(_digest(actual),_digest({**actual,"sourceRef":"b"*64}))
        self.assertNotEqual(_digest(actual),_digest({**actual,"content":"Other note"}))
        self.assertNotEqual(_digest(actual),_digest({**actual,"accountId":str(uuid4())}))

    def test_forged_tenant_and_unverified_source_refused(self):
        base=sample()
        attempts=[
            {"workspaceId":str(uuid4())},{"authorUserId":str(uuid4())},
            {"reviewVersion":1},{"kind":"EXECUTION"},{"tradeEventId":str(uuid4())},
            {"ticker":"../TEST"},{"accountId":str(uuid4())+"bad"},
            {"sourceRef":"0"*63},{"sourceRef":"G"*64},{"content":"  "},
            {"content":"x"*6001},{"idempotencyKey":"abc"},
        ]
        for bad in attempts:
            with self.subTest(bad=bad),self.assertRaises(TradeInputError):
                normalize_broker_note({**base,**bad})
        with self.assertRaises(TradeInputError):
            normalize_broker_note({k:v for k,v in base.items() if k!="ticker"})

    def test_reject_missing_or_cross_tenant_release_before_financial_write(self):
        base=sample()
        for current in (
            {"readEnabled":False,"executions":[]},
            {"readEnabled":True,"executions":[{"accountId":base["accountId"],
                 "sourceRef":"b"*64,"symbol":"TEST","provenance":"BROKER_VERIFIED"}]},
            {"readEnabled":True,"executions":[{"accountId":str(uuid4()),
                 "sourceRef":base["sourceRef"],"symbol":"TEST","provenance":"BROKER_VERIFIED"}]},
            {"readEnabled":True,"executions":[{"accountId":base["accountId"],
                 "sourceRef":base["sourceRef"],"symbol":"OTHER","provenance":"BROKER_VERIFIED"}]},
        ):
            with self.subTest(current=current),\
                 patch("services.saas_api.journal_broker_links._confirmed_scope",
                       return_value={"workspaceId":str(uuid4()),"userId":str(uuid4())}),\
                 patch("services.saas_api.journal_broker_links.private_ledger",
                       return_value=current):
                with self.assertRaises(TradeNotFound):
                    create_broker_note(None,None,None,"synthetic-user",base)

if __name__=="__main__":
    unittest.main()
