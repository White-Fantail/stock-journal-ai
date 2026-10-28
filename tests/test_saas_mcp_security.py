"""MCP OAuth grant nonces remain one-use for the entire refresh lifetime."""
import hashlib
import unittest
import uuid
from contextlib import nullcontext
from datetime import datetime, timedelta, timezone

from services.saas_api.request_security import consume_mcp_grant_nonce, RequestRejected


class StubCursor:
    def __init__(self, consumed):
        self.consumed = consumed

    def fetchone(self):
        return None if self.consumed else ("recorded",)


class StubConnection:
    def __init__(self):
        self.consumed = False
        self.last = None

    def transaction(self):
        return nullcontext()

    def execute(self, sql, args):
        self.last = (sql, args)
        result = StubCursor(self.consumed)
        self.consumed = True
        return result


class McpGrantNonceTests(unittest.TestCase):
    def test_refresh_nonce_durable_for_full_token_lifetime(self):
        conn = StubConnection()
        nonce = str(uuid.uuid4())
        exp = int((datetime.now(timezone.utc) + timedelta(days=6)).timestamp())
        consume_mcp_grant_nonce(conn, nonce, exp)
        stored = conn.last[1]
        self.assertEqual(stored[0], hashlib.sha256(("positionary-mcp:" + nonce).encode()).hexdigest())
        self.assertNotIn(nonce, str(conn.last))
        self.assertEqual(int(stored[1].timestamp()), exp)
        with self.assertRaises(RequestRejected):
            consume_mcp_grant_nonce(conn, nonce, exp)

    def test_reject_expired_oversized_or_invalid_nonce(self):
        now = int(datetime.now(timezone.utc).timestamp())
        for nonce, expiry in [
            ("not-a-uuid", now + 300),
            (str(uuid.uuid4()), now - 1),
            (str(uuid.uuid4()), now + 8 * 86400),
            (str(uuid.uuid4()), True),
        ]:
            with self.subTest(nonce=nonce, expiry=expiry):
                conn = StubConnection()
                with self.assertRaises(RequestRejected):
                    consume_mcp_grant_nonce(conn, nonce, expiry)
                self.assertIsNone(conn.last)


if __name__ == "__main__":
    unittest.main()
