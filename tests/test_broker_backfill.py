"""Offline P3 replay, incomplete coverage and source identity tests."""
import unittest
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from services.broker_connectors.backfill import (
    MAX_WINDOWS, WindowResult, coverage, plan_backfill, source_key,
)


class BackfillTests(unittest.TestCase):
    def setUp(self):
        self.wid, self.cid, self.aid = uuid4(), uuid4(), uuid4()
        self.start = datetime(2026, 10, 20, 10, tzinfo=timezone(timedelta(hours=13)))

    def plan(self, days=30):
        return plan_backfill(self.wid,self.cid,self.aid,self.start,
                             self.start + timedelta(days=75),days=days)

    def test_windows_are_contiguous_half_open_bounded_utc(self):
        p = self.plan()
        self.assertEqual(len(p.windows),3)
        self.assertEqual(p.windows[0].start_utc.utcoffset(),timedelta(0))
        self.assertEqual([w.end_utc-w.start_utc for w in p.windows],
                         [timedelta(days=30),timedelta(days=30),timedelta(days=15)])
        self.assertEqual(p.windows[0].end_utc,p.windows[1].start_utc)
        self.assertEqual(p.windows[-1].end_utc,self.start.astimezone(timezone.utc)+timedelta(days=75))

    def test_replay_key_is_stable_and_account_scoped(self):
        p = self.plan()
        self.assertEqual(p.idempotency_key,self.plan().idempotency_key)
        self.assertNotEqual(p.idempotency_key, self.plan(25).idempotency_key)
        different=plan_backfill(self.wid,self.cid,uuid4(),self.start,self.start+timedelta(days=75))
        self.assertNotEqual(p.idempotency_key,different.idempotency_key)

    def test_bad_time_ids_and_unbounded_ranges_fail(self):
        with self.assertRaises(TypeError):
            plan_backfill("browser",self.cid,self.aid,self.start,self.start+timedelta(days=1))
        for a,b in ((self.start.replace(tzinfo=None),self.start+timedelta(days=1)),
                    (self.start,self.start), (self.start,self.start-timedelta(days=1))):
            with self.assertRaises(ValueError):
                plan_backfill(self.wid,self.cid,self.aid,a,b)
        for days in (0,90,True,"30"):
            with self.assertRaises(ValueError):
                self.plan(days)
        with self.assertRaises(ValueError):
            plan_backfill(self.wid,self.cid,self.aid,self.start,
                          self.start+timedelta(days=MAX_WINDOWS+1),days=1)

    def test_partial_is_never_claimed_complete(self):
        p=self.plan()
        self.assertEqual(coverage(p,())[0],"PENDING")
        self.assertEqual(coverage(p,(WindowResult(0,"COMPLETE",1),))[0],"PENDING")
        state,done,total,issues=coverage(p,(WindowResult(0,"COMPLETE",1),
                                    WindowResult(1,"PARTIAL",5,("PAGE_GAP",))))
        self.assertEqual((state,done,total,issues),("PARTIAL",1,3,("PAGE_GAP",)))
        self.assertEqual(coverage(p,tuple(WindowResult(i,"COMPLETE",1)
                                              for i in range(3)))[0],"COMPLETE")
        for items in ((WindowResult(0,"COMPLETE",1),WindowResult(0,"COMPLETE",1)),
                      (WindowResult(3,"COMPLETE",1),),(WindowResult(0,"COMPLETE",6),)):
            with self.assertRaises(ValueError):
                coverage(p,items)

    def test_hmac_id_is_secret_and_account_scoped(self):
        a=source_key(b"k"*32,"TIGER",self.aid,"FILL","synthetic-123")
        self.assertEqual(len(a),64)
        self.assertNotIn("synthetic",a)
        self.assertEqual(a,source_key(b"k"*32,"TIGER",self.aid,"FILL","synthetic-123"))
        self.assertNotEqual(a,source_key(b"k"*32,"TIGER",uuid4(),"FILL","synthetic-123"))
        with self.assertRaises(ValueError):
            source_key(b"short","TIGER",self.aid,"FILL","synthetic-123")


if __name__ == "__main__":
    unittest.main()
