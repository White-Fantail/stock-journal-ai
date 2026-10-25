"""P4 offline proof gate: never publish customer holdings from unsigned facts."""
import unittest
from dataclasses import replace
from datetime import datetime,timedelta,timezone
from decimal import Decimal
from uuid import uuid4

from services.broker_connectors.contracts import BrokerPosition
from services.broker_connectors.fifo_projection import VerifiedExecution
from services.broker_connectors.reconciliation import AccountEvidence,CertifiedWindow,PositionEvidence
from services.saas_api.reconciliation_store import (
    AuditRefused,_input_digest,_attested,_number,_version_key,
)

T=datetime(2026,10,10,tzinfo=timezone.utc)
D=Decimal

def sample():
    f=VerifiedExecution("synthetic-fill","TEST","BUY",D("2"),D("10"),"USD",
                        T,D("1"),"USD")
    return AccountEvidence(uuid4(),uuid4(),T,T+timedelta(days=1),
        (CertifiedWindow(T,T+timedelta(days=1),True),),(f,),
        PositionEvidence(T+timedelta(days=1),(BrokerPosition("TEST",D("2"),"USD"),),True),
        True,True,True)

class AuditContractTests(unittest.TestCase):
    def test_digest_binds_account_and_evidence(self):
        a=sample()
        first=_input_digest(a,b"s"*32)
        self.assertEqual(len(first),64)
        self.assertNotEqual(first,_input_digest(replace(a,account_id=uuid4()),b"s"*32))
        self.assertNotEqual(first,_input_digest(replace(a,executions=(
            replace(a.executions[0],quantity=D("3")),)),b"s"*32))
        self.assertNotIn("synthetic-fill",first)

    def test_attestation_missing_or_provider_unapproved(self):
        self.assertFalse(_attested("a"*64,None))
        self.assertFalse(_attested("a"*64,"f"*64))
        self.assertNotEqual(_version_key(b"a"*32,"b"*64,False),
                            _version_key(b"a"*32,"b"*64,True))

    def test_reject_rounding_and_excess_money(self):
        for value in (D("NaN"),D("Infinity"),D("-0.01"),
                      D("0.0000000000001"),D("1000000000000000000000000")):
            with self.subTest(value=str(value)):
                with self.assertRaises(AuditRefused):
                    _number(value)
        self.assertEqual(_number(D("123.000000000001")),D("123.000000000001"))
        self.assertEqual(_number(D("-5.25"),signed=True),D("-5.25"))
        # PostgreSQL NUMERIC(36,12) supports 36 significant digits.
        # Default Decimal context precision is too small for this value.
        near_limit=D("999999999999999999999999.123456789012")
        self.assertEqual(_number(near_limit),near_limit)
        with self.assertRaises(AuditRefused):
            _number(D("999999999999999999999999.1234567890123"))

if __name__=="__main__":
    unittest.main()
