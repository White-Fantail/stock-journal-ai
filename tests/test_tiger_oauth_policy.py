import base64
import os
import unittest
from unittest.mock import patch
from services.saas_api.tiger_oauth import config, seal, unseal, TigerError, _provider_request

VALID = {
    "TIGER_PARTNER_OAUTH_APPROVED": "1",
    "TIGER_READ_ONLY_GRANT_VERIFIED": "1",
    "TIGER_CLIENT_ID": "partner-test",
    "TIGER_CLIENT_SECRET": "x" * 40,
    "TIGER_REDIRECT_URI": "https://example.test/api/private/tiger/callback",
    "TIGER_APPROVED_READ_SCOPES": "uuid api.basic:read",
    "TIGER_VAULT_KEY_B64": base64.b64encode(b"K" * 32).decode(),
}

class TigerOAuthPolicyTests(unittest.TestCase):
    def test_approval_and_explicit_read_grant_required(self):
        self.assertEqual(config(VALID)["scopes"], ("uuid", "api.basic:read"))
        for key in ("TIGER_PARTNER_OAUTH_APPROVED", "TIGER_READ_ONLY_GRANT_VERIFIED"):
            with self.assertRaises(TigerError):
                config({**VALID, key: "0"})

    def test_write_trade_broad_or_bad_scope_rejected(self):
        for scopes in ("api.trade", "api.orders:read", "uuid api.account:write",
                       "uuid  api.basic:read", "uuid uuid"):
            with self.subTest(scopes=scopes), self.assertRaises(TigerError):
                config({**VALID, "TIGER_APPROVED_READ_SCOPES": scopes})

    def test_redirect_requires_secure_exact_url(self):
        for url in ("http://example.test/callback", "https://example.test/c?x=1", "not-a-url"):
            with self.assertRaises(TigerError):
                config({**VALID, "TIGER_REDIRECT_URI": url})

    def test_aead_is_tenant_and_connection_bound(self):
        with patch.dict(os.environ, VALID):
            sealed = seal({"access": "example-token"}, "workspace1:connection1")
            self.assertNotIn(b"example-token", sealed)
            self.assertEqual(unseal(sealed,"workspace1:connection1")["access"], "example-token")
            with self.assertRaises(TigerError):
                unseal(sealed,"workspace2:connection1")
            changed = bytearray(sealed)
            changed[-1] ^= 1
            with self.assertRaises(TigerError):
                unseal(bytes(changed),"workspace1:connection1")

    def test_network_is_static_host_and_requires_token(self):
        with self.assertRaises(TigerError):
            _provider_request("https://evil.example/data", access_token="x")
        with self.assertRaises(TigerError):
            _provider_request("https://openapi.tigerfintech.com/api/v1/accounts")
            
if __name__ == "__main__":
    unittest.main()
