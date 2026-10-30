"""Isolated Tiger refresh coordinator: synthetic security and scheduling tests."""
import hashlib
import hmac
import json
import os
import time
import unittest
from datetime import datetime, timezone
from unittest.mock import patch
from uuid import uuid4

from temporary.tiger_personal import refresh_worker as worker


class TestPersonalRefresh(unittest.TestCase):
    def setUp(self):
        worker._NONCES.clear()
        with worker._GUARD:
            worker._RUNNING=False
            worker._STATE="IDLE"
            worker._MANUAL_AT=0
            worker._SLOTS.clear()
        self.env={"POSITIONARY_PERSONAL_BRIDGE_SECRET":"s"*40,
                  "POSITIONARY_PERSONAL_GOOGLE_SUBJECT":"1234567890",
                  "POSITIONARY_PERSONAL_TIGER_ENABLED":"1"}

    def signed(self, subject="1234567890", path=worker._PATH_REQUEST, nonce=None):
        value={"subject":subject}
        raw=json.dumps(value,separators=(",",":")).encode()
        stamp=str(int(time.time()))
        nonce=nonce or str(uuid4())
        sig=hmac.new(self.env["POSITIONARY_PERSONAL_BRIDGE_SECRET"].encode(),
                     f"{stamp}\n{nonce}\nPOST\n{path}\n".encode()+raw,
                     hashlib.sha256).hexdigest()
        return value,{"X-Saas-Timestamp":stamp,
                      "X-Saas-Nonce":nonce,"X-Saas-Signature":sig}

    def test_hmac_owner_and_replay(self):
        with patch.dict(os.environ,self.env):
            body,head=self.signed()
            self.assertTrue(worker._authenticated(worker._PATH_REQUEST,body,head))
            self.assertFalse(worker._authenticated(worker._PATH_REQUEST,body,head))
            body,head=self.signed("not-owner")
            self.assertFalse(worker._authenticated(worker._PATH_REQUEST,body,head))
            body,head=self.signed()
            head["X-Saas-Signature"]="0"*64
            self.assertFalse(worker._authenticated(worker._PATH_REQUEST,body,head))
            body,head=self.signed()
            self.assertFalse(worker._authenticated(worker._PATH_STATUS,body,head))

    def test_regular_session_handles_new_york_dst(self):
        self.assertEqual(worker._due_slot(datetime(2026,10,30,13,30,tzinfo=timezone.utc)),
                         ("HOURLY","2026-10-30:09"))
        self.assertEqual(worker._due_slot(datetime(2026,11,2,14,30,tzinfo=timezone.utc)),
                         ("HOURLY","2026-11-02:09"))
        self.assertIsNone(worker._due_slot(datetime(2026,11,1,14,30,tzinfo=timezone.utc)))
        self.assertIsNone(worker._due_slot(datetime(2026,11,2,14,29,tzinfo=timezone.utc)))
        self.assertEqual(worker._due_slot(datetime(2026,11,2,22,0,tzinfo=timezone.utc)),
                         ("DAILY","2026-11-02"))

    def test_single_flight_and_manual_cooldown(self):
        with patch.object(worker.threading,"Thread") as thread:
            first=worker._launch("MANUAL",manual=True)
            self.assertEqual(first["state"],"RUNNING")
            self.assertEqual(worker._launch("MANUAL",manual=True)["state"],"RUNNING")
            self.assertEqual(thread.call_count,1)
            with worker._GUARD:
                worker._RUNNING=False
            self.assertEqual(worker._launch("MANUAL",manual=True)["state"],"COOLDOWN")
            self.assertEqual(thread.call_count,1)

    def test_recent_sync_calls_bounded_observations(self):
        from temporary.tiger_personal import history_sync,fill_probe_worker
        with patch.object(history_sync,"sync_history",
                          return_value={"rangeComplete":True}) as orders, \
             patch.object(fill_probe_worker,"sync_probe") as fills:
            worker._quick_sync()
            orders.assert_called_once_with(recent_days=30)
            fills.assert_called_once()


if __name__=="__main__":
    unittest.main()
