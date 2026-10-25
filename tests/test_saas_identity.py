import hashlib
import hmac
import time
import unittest

from services.saas_api.identity import validate_google_claims
from services.saas_api.server import authorized

class SaaSIdentityTests(unittest.TestCase):
    def test_google_subject_and_verified_email(self):
        ok={"subject":"123456789012345678","email":"Alice@Example.com","email_verified":True,"name":"Alice"}
        self.assertEqual(validate_google_claims(ok),("123456789012345678","alice@example.com","Alice"))
        for invalid in ({**ok,"email_verified":False},{**ok,"subject":"github-owner"},
                        {**ok,"subject":""},{**ok,"email":"invalid"},{}):
            with self.assertRaises(ValueError):
                validate_google_claims(invalid)

    def test_internal_hmac_blocks_forgery_and_replay(self):
        secret="test-hmac-secret-never-deployed-32-plus-chars"
        body=b'{"subject":"123456789012345678"}'
        stamp=str(int(time.time()))
        path="/internal/v1/resolve"
        nonce="00000000-0000-4000-8000-000000000001"
        sig=hmac.new(secret.encode(),f"{stamp}\n{nonce}\nPOST\n{path}\n".encode()+body,hashlib.sha256).hexdigest()
        headers={"X-Saas-Timestamp":stamp,"X-Saas-Nonce":nonce,"X-Saas-Signature":sig}
        self.assertTrue(authorized("POST",path,body,headers,secret))
        self.assertFalse(authorized("POST",path,body+b"x",headers,secret))
        self.assertFalse(authorized("POST","/internal/v1/provision",body,headers,secret))
        self.assertFalse(authorized("POST",path,body,headers,"short"))
        self.assertFalse(authorized("POST",path,body,headers,secret,now=int(stamp)+31))
        self.assertFalse(authorized("POST",path,body,{},secret))
        self.assertFalse(authorized("POST",path,body,{**headers,"X-Saas-Nonce":"bad"},secret))

if __name__=="__main__":
    unittest.main()
