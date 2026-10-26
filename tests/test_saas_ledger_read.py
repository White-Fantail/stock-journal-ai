"""P4 broker-ledger read gates: no unapproved facts, raw IDs or stale publication."""
import unittest
from contextlib import nullcontext
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from services.saas_api.ledger_read import (
    _matching_published_review, _read_enabled, private_ledger,
)
from services.saas_api.ledger_publication import PublicationRefused

T=datetime(2026,10,26,tzinfo=timezone.utc)
D=Decimal


class FakeResult:
    def __init__(self, value):
        self.value=value
    def fetchone(self):
        return self.value
    def fetchall(self):
        return self.value


class FakeBroker:
    def __init__(self, *, state="STAGED", has_publication=True, altered_links=False):
        self.account=uuid4()
        self.version=uuid4()
        self.publication=uuid4()
        self.stage=uuid4()
        self.state=state
        self.published=has_publication
        self.altered_links=altered_links
        self.revision=("a"*64)
        self.signature=("b"*64)
        self.source=("c"*64)
        self.sha=("d"*64)
        self.calls=[]
    def transaction(self):
        return nullcontext()
    def execute(self, statement, params=()):
        self.calls.append(statement)
        if "pg_advisory_xact_lock" in statement:
            return FakeResult((None,))
        if "SELECT v.id,v.version_num,v.state" in statement:
            return FakeResult((self.version,4,self.state,
                self.revision if self.published else None,
                self.signature,1,self.publication))
        if "FROM saas_broker_ledger_sources" in statement:
            return FakeResult([(self.source,self.stage,("f"*64 if self.altered_links else self.sha))])
        if "FROM saas_broker_accounts a" in statement:
            return FakeResult([(self.account,"Tiger ••••0000")])
        raise AssertionError("unexpected database query (fixture lacks authorization)")


class PrivateLedgerGateTests(unittest.TestCase):
    def test_no_broker_facts_without_explicit_four_way_approval(self):
        full={"SAAS_P4_LEDGER_READ_ENABLED":"1","SAAS_P4_PUBLICATION_ENABLED":"1",
              "TIGER_PARTNER_OAUTH_APPROVED":"1","TIGER_READ_ONLY_GRANT_VERIFIED":"1"}
        with patch.dict("os.environ",full):
            self.assertTrue(_read_enabled())
            for key in full:
                with self.subTest(key=key),patch.dict("os.environ",{key:"0"}):
                    self.assertFalse(_read_enabled())

    def test_latest_staged_and_exact_source_links_are_required(self):
        for state, published, altered in (
            ("BLOCKED",True,False),("STAGED",False,False),
            ("STAGED",True,True),
        ):
            b=FakeBroker(state=state,has_publication=published,altered_links=altered)
            fills=[(b.source,b.stage,b.sha,"TEST","BUY","USD",D("2"),
                    D("10"),D("1"),T)]
            positions=[("TEST","USD",D("2"),D("21"),D("0"))]
            with patch("services.saas_api.ledger_read._candidate",
                       return_value=(b.version,4,T,fills,positions,b.revision)),\
                 patch("services.saas_api.ledger_read._approved",return_value=True):
                self.assertIsNone(_matching_published_review(b,str(uuid4()),b.account))
        b=FakeBroker()
        fills=[(b.source,b.stage,b.sha,"TEST","BUY","USD",D("2"),
                D("10"),D("1"),T)]
        positions=[("TEST","USD",D("2"),D("21"),D("0"))]
        with patch("services.saas_api.ledger_read._candidate",
                   return_value=(b.version,4,T,fills,positions,b.revision)),\
             patch("services.saas_api.ledger_read._approved",return_value=True):
            found=_matching_published_review(b,str(uuid4()),b.account)
            self.assertEqual(found[0],4)
            self.assertEqual(found[2],fills)
        with patch("services.saas_api.ledger_read._candidate",
                   side_effect=PublicationRefused("SOURCE_VERSION_CHANGED")):
            self.assertIsNone(_matching_published_review(b,str(uuid4()),b.account))

    def test_disabled_read_is_empty_but_still_checks_identity(self):
        b=FakeBroker()
        with patch("services.saas_api.ledger_read._scope",return_value=str(uuid4())) as auth,\
             patch("services.saas_api.ledger_read._read_enabled",return_value=False):
            result=private_ledger(None,b,"synthetic-user")
        auth.assert_called_once()
        self.assertFalse(result["readEnabled"])
        self.assertEqual(result["coverage"],"UNVERIFIED")
        self.assertEqual(result["executions"],[])
        self.assertEqual(result["positions"],[])
        self.assertEqual(b.calls,[])

    def test_revoked_or_unauthorized_account_cannot_publish_fills(self):
        b=FakeBroker()
        with patch("services.saas_api.ledger_read._scope",return_value=str(uuid4())),\
             patch("services.saas_api.ledger_read._read_enabled",return_value=True),\
             patch("services.saas_api.ledger_read._account_authorized",return_value=False),\
             patch("services.saas_api.ledger_read._matching_published_review") as ledger:
            result=private_ledger(None,b,"synthetic-user")
        self.assertEqual(result["accounts"][0]["state"],"NOT_AUTHORIZED")
        self.assertEqual(result["executions"],[])
        ledger.assert_not_called()


if __name__=="__main__":
    unittest.main()
