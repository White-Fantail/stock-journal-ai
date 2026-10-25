"""P3 worker validation: never certify shadow evidence as full history."""
import unittest
from datetime import datetime,timezone,timedelta
from decimal import Decimal
from uuid import uuid4
from services.broker_connectors.contracts import (
    BrokerFill,BrokerSyncBatch,BrokerSyncRequest,SyncWindow,
)
from services.saas_api.backfill_worker import WorkerRefused,_validate_batch

T=datetime(2026,10,20,tzinfo=timezone.utc)


def payload():
    req=BrokerSyncRequest(uuid4(),uuid4(),uuid4(),SyncWindow(T,T+timedelta(days=1)))
    fill=BrokerFill("s1","o1","TEST","BUY",Decimal("2"),Decimal("10"),
                    "USD_UNVERIFIED",None,"UNVERIFIED",None,"2026-10-20 12:00")
    return req,BrokerSyncBatch(req,"TIGER","COMPLETE",(fill,),(),1,())


class WorkerContracts(unittest.TestCase):
    def test_shadows_report_uncertainty(self):
        req,batch=payload()
        rows,issues=_validate_batch(req,batch)
        self.assertEqual(len(rows),1)
        self.assertEqual(set(issues),{
            "HISTORY_COVERAGE_UNVERIFIED","CURRENCY_UNVERIFIED","FEE_UNKNOWN","TIME_UNVERIFIED"})
        self.assertIsNone(rows[0][1]["executedAt"])

    def test_foreign_scope_denied(self):
        req,batch=payload()
        forged=BrokerSyncRequest(uuid4(),req.connection_id,req.account_id,req.window)
        with self.assertRaises(WorkerRefused):
            _validate_batch(forged,batch)

    def test_unbounded_or_malformed_source_denied(self):
        req,batch=payload()
        malicious=BrokerFill("","o1","TEST","BUY",Decimal("1"),Decimal("10"),
                             "USD",T,"VERIFIED_OFFSET",Decimal("0"),None)
        with self.assertRaises(WorkerRefused):
            _validate_batch(req,BrokerSyncBatch(req,"TIGER","COMPLETE",
                                                 (malicious,),(),1,()))
        with self.assertRaises(WorkerRefused):
            _validate_batch(req,BrokerSyncBatch(req,"TIGER","COMPLETE",
                                                 tuple(batch.fills*1001),(),1,()))

if __name__=="__main__":
    unittest.main()
