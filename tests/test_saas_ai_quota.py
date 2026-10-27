"""AI usage quotas: explicit consent, active tenant, atomic daily/monthly."""
from __future__ import annotations
import unittest
from contextlib import nullcontext
from unittest.mock import patch
from uuid import uuid4
from services.saas_api.ai_quota import claim_ai, LIMIT_DAY, LIMIT_MONTH
from services.saas_api.trades import TradeInputError,TradeConflict

class Database:
    def __init__(self,counts=None):
        self.counts=counts or {}
        self.queries=[]
    def transaction(self): return nullcontext()
    def execute(self,sql,params):
        self.queries.append((sql,params))
        if "pg_advisory_xact_lock" in sql:
            return None
        bucket=params[1]
        n=self.counts.get(bucket,0)
        limit=params[-1]
        class Result:
            def fetchone(self_non):
                if n>=limit:return None
                self.counts[bucket]=n+1
                return (n+1,)
        return Result()

class AiQuotaTests(unittest.TestCase):
    def test_explicit_optin_scope_and_mode(self):
        for payload in (
            {},{"mode":"HABITS","consented":False},
            {"mode":"HABITS","consented":"true"},
            {"mode":"ALL_TENANTS","consented":True},
            {"mode":"HABITS","consented":True,"workspaceId":str(uuid4())},
            {"mode":"STOCK_REVIEW","consented":True,"accountId":str(uuid4())},
        ):
            with self.subTest(payload=payload),self.assertRaises(TradeInputError):
                claim_ai(None,None,"123456",payload)

    def test_bucket_limits_and_current_owner_rechecked_every_call(self):
        scope={"workspaceId":str(uuid4()),"userId":str(uuid4()),"role":"OWNER"}
        broker=Database()
        with patch("services.saas_api.ai_quota._confirmed_scope",return_value=scope) as confirmed,\
             patch("services.saas_api.ai_quota._runtime_safety"),\
             patch("services.saas_api.ai_quota._tenant_scope") as tenant:
            for _ in range(LIMIT_DAY):
                value=claim_ai(None,broker,"123456",{"mode":"HABITS","consented":True})
                self.assertTrue(value["claimed"])
            with self.assertRaises(TradeConflict):
                claim_ai(None,broker,"123456",{"mode":"HABITS","consented":True})
            self.assertEqual(broker.counts["DAY"],LIMIT_DAY)
            self.assertEqual(broker.counts["MONTH"],LIMIT_DAY)
            self.assertEqual(confirmed.call_count,LIMIT_DAY+1)
            self.assertEqual(tenant.call_count,LIMIT_DAY+1)
            self.assertTrue(all(x.args[1]["workspaceId"]==scope["workspaceId"] for x in tenant.call_args_list))
            self.assertEqual(LIMIT_MONTH,60)

    def test_coaching_uses_identical_explicit_consent_and_shared_quota(self):
        scope={"workspaceId":str(uuid4()),"userId":str(uuid4()),"role":"OWNER"}
        db=Database()
        with patch("services.saas_api.ai_quota._confirmed_scope",return_value=scope),\
             patch("services.saas_api.ai_quota._runtime_safety"),\
             patch("services.saas_api.ai_quota._tenant_scope"):
            result=claim_ai(None,db,"123456",{"mode":"COACHING","consented":True})
            self.assertEqual(result["remainingDay"],LIMIT_DAY-1)
            self.assertEqual(db.counts["DAY"],1)
            self.assertEqual(db.counts["MONTH"],1)
        for payload in ({"mode":"COACHING","consented":False},
                        {"mode":"COACHING","consented":True,"accountId":"forged"}):
            with self.assertRaises(TradeInputError):
                claim_ai(None,None,"123456",payload)

    def test_revoked_membership_blocks_before_database_write(self):
        with patch("services.saas_api.ai_quota._confirmed_scope",side_effect=TradeConflict("revoked")):
            with self.assertRaises(TradeConflict):
                claim_ai(None,Database(),"123456",{"mode":"STOCK_REVIEW","consented":True})

if __name__=="__main__":
    unittest.main()
