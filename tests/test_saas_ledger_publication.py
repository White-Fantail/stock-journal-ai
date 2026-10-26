"""Offline release gate tests. Never substitute these for live Tiger approval."""
import hashlib
import hmac
import os
import unittest
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4
from services.saas_api.ledger_publication import _approved, _digest, PublicationRefused, release_verified_review

T = datetime(2026, 10, 25, tzinfo=timezone.utc)
D = Decimal

def sample():
    wid, aid, vid, sid = uuid4(), uuid4(), uuid4(), uuid4()
    fill = ("a"*64, sid, "b"*64, "TEST", "BUY", "USD", D("2"), D("10"), D("1"), T)
    pos = ("TEST", "USD", D("2"), D("21"), D("0"))
    return wid, aid, vid, fill, pos

class LedgerPublicationContract(unittest.TestCase):
    def test_proof_is_tenant_version_source_and_amount_bound(self):
        wid, aid, vid, fill, pos = sample()
        proof = _digest(wid, aid, vid, 1, "f"*64, T, [fill], [pos])
        self.assertEqual(len(proof), 64)
        self.assertNotIn("TEST", proof)
        self.assertNotEqual(proof, _digest(uuid4(), aid, vid, 1, "f"*64, T, [fill], [pos]))
        self.assertNotEqual(proof, _digest(wid, aid, uuid4(), 1, "f"*64, T, [fill], [pos]))
        self.assertNotEqual(proof, _digest(wid, aid, vid, 1, "f"*64, T, [
            (*fill[:7], D("11"), *fill[8:])], [pos]))
        self.assertNotEqual(proof, _digest(wid, aid, vid, 1, "f"*64, T, [
            (*fill[:2], "c"*64, *fill[3:])], [pos]))
        self.assertNotEqual(proof, _digest(wid, aid, vid, 1, "f"*64, T, [fill], [
            (*pos[:3], D("22"), *pos[4:])]))

    def test_broker_approval_alone_cannot_issue_proof(self):
        proof="a"*64
        key="d"*64
        signed=hmac.new(bytes.fromhex(key),
            ("positionary:p4:publish:v1:"+proof).encode(),hashlib.sha256).hexdigest()
        with patch.dict(os.environ, {"SAAS_P4_PUBLICATION_KEY": key,
                                     "SAAS_P4_PUBLICATION_ENABLED": "0",
                                     "TIGER_PARTNER_OAUTH_APPROVED": "1",
                                     "TIGER_READ_ONLY_GRANT_VERIFIED": "1"}):
            self.assertFalse(_approved(proof, signed))
        with patch.dict(os.environ, {"SAAS_P4_PUBLICATION_KEY": key,
                                     "SAAS_P4_PUBLICATION_ENABLED": "1",
                                     "TIGER_PARTNER_OAUTH_APPROVED": "1",
                                     "TIGER_READ_ONLY_GRANT_VERIFIED": "0"}):
            self.assertFalse(_approved(proof, signed))
        with patch.dict(os.environ, {"SAAS_P4_PUBLICATION_KEY": key,
                                     "SAAS_P4_PUBLICATION_ENABLED": "1",
                                     "TIGER_PARTNER_OAUTH_APPROVED": "1",
                                     "TIGER_READ_ONLY_GRANT_VERIFIED": "1"}):
            self.assertTrue(_approved(proof,signed))
            self.assertFalse(_approved(proof,"0"*64))
            self.assertFalse(_approved(proof,None))

    def test_publication_rejects_untrusted_account_and_version_before_db(self):
        for account, version in (("wrong",1), (str(uuid4()),0),
                                 (str(uuid4()),True), (str(uuid4()),"1")):
            with self.subTest(account=account,version=version):
                with self.assertRaises(PublicationRefused):
                    release_verified_review(None,None,"subject",account,version)

if __name__ == "__main__":
    unittest.main()
