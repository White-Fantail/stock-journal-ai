"""Synthetic-only health ingress, provenance and multi-tenant boundary tests."""
import os,unittest
from unittest.mock import patch
from uuid import uuid4
from temporary.tiger_personal.sync_health import _validate,view_health,import_health
from temporary.tiger_personal.api import PilotError

OWNER="1234567890"
ENV={"POSITIONARY_PERSONAL_TIGER_ENABLED":"1","POSITIONARY_PERSONAL_GOOGLE_SUBJECT":OWNER}

def payload(**over):
    return {"subject":OWNER,"account":"U12345678","runId":str(uuid4()),
            "assets":"OK","orders":"PARTIAL","fills":"UNAVAILABLE",**over}

class HealthTests(unittest.TestCase):
    def test_unauthorized_or_overshared_ingress_is_rejected(self):
        with patch.dict(os.environ,ENV,clear=True):
            assert _validate(payload())[0]=="U12345678"
            for bad in ({"subject":"9999999"},{"workspaceId":str(uuid4())},
                        {"accountId":str(uuid4())},{"runId":"not-uuid"},
                        {"assets":"VERIFIED"},{"orders":"VERIFIED"},
                        {"fills":"BROKER_VERIFIED"},{"fills":True}):
                with self.subTest(bad=bad),self.assertRaises(PilotError):
                    _validate(payload(**bad))
        with patch.dict(os.environ,{},clear=True):
            with self.assertRaises(PilotError):_validate(payload())

    def test_import_only_looks_up_private_account_with_hmac_fingerprint(self):
        class DB:
            def transaction(self):
                from contextlib import nullcontext
                return nullcontext()
            def execute(self,sql,args):
                self.sql=sql;self.args=args
                class Result:
                    def fetchone(self):return None
                return Result()
        broker=DB()
        with patch.dict(os.environ,ENV,clear=True),\
             patch("temporary.tiger_personal.sync_health._scope",return_value=str(uuid4())),\
             patch("temporary.tiger_personal.sync_health._key",return_value=b"random_secret_for_test"):
            with self.assertRaises(PilotError):
                import_health(None,broker,payload())
            self.assertIn("external_account_fingerprint",broker.sql)
            self.assertNotIn("U12345678",str(broker.args))
            self.assertNotIn("saas_trade_events",broker.sql)

if __name__=="__main__":
    unittest.main()
