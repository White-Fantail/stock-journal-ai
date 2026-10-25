"""P3 source-only pagination contract: bounded size and explicit termination."""
import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

from services.broker_connectors.contracts import BrokerFill, BrokerSyncRequest, SyncWindow
from services.broker_connectors.paged_contract import ReadPage, MAX_PAGE_ITEMS, MAX_WINDOW_PAGES
from services.saas_api.paged_backfill import _page_to_stage, _cursor_aad
from services.saas_api.backfill_worker import WorkerRefused

T = datetime(2026, 10, 20, tzinfo=timezone.utc)


def request():
    return BrokerSyncRequest(uuid4(), uuid4(), uuid4(), SyncWindow(T, T + timedelta(days=1)))


def fill(code="synthetic-1"):
    return BrokerFill(code, "order-1", "TEST", "BUY", Decimal("1"), Decimal("2"), "USD",
                      T, "VERIFIED_OFFSET", Decimal("0"), T.isoformat())


class PagedReadContractTests(unittest.TestCase):
    def test_bounds_are_hard_capped(self):
        req=request()
        self.assertEqual(MAX_PAGE_ITEMS, 100)
        self.assertEqual(MAX_WINDOW_PAGES, 50)
        with self.assertRaises(ValueError):
            ReadPage(req, tuple(fill(str(i)) for i in range(101)), "next", False)
        self.assertIsNotNone(ReadPage(req, (fill(),), None, True))

    def test_end_is_explicit_and_opaque(self):
        req=request()
        for cursor, terminal in ((None,False),("cursor",True),("",False),("\n",False),
                                 ("a"*257,False)):
            with self.subTest(cursor=cursor,terminal=terminal):
                with self.assertRaises(ValueError):
                    ReadPage(req, (), cursor, terminal)
        self.assertEqual(ReadPage(req, (), "opaque", False).next_cursor,"opaque")

    def test_foreign_request_fails(self):
        req=request()
        forged=ReadPage(request(), (fill(),), None, True)
        with self.assertRaises(WorkerRefused):
            _page_to_stage(req, forged, None, [], 0)

    def test_cursor_loop_fails_without_staging(self):
        req=request()
        first=ReadPage(req, (fill(),), "next-1", False)
        data, issues, seen = _page_to_stage(req, first, None, [], 0)
        self.assertEqual(len(data),1)
        self.assertIn("HISTORY_COVERAGE_UNVERIFIED", issues)
        with self.assertRaises(WorkerRefused):
            _page_to_stage(req, ReadPage(req, (fill(),), "next-1", False), "next-1", seen, 1)

    def test_different_tenant_cursor_encryption_context(self):
        from uuid import uuid4
        self.assertNotEqual(_cursor_aad(uuid4(),uuid4(),uuid4()),
                            _cursor_aad(uuid4(),uuid4(),uuid4()))

    def test_fifty_page_cap_does_not_pretend_coverage(self):
        req=request()
        seen=["a"*64]*(MAX_WINDOW_PAGES-1)
        with self.assertRaises(WorkerRefused):
            _page_to_stage(req, ReadPage(req, (fill(),), "next-50", False),
                           "prior", seen, MAX_WINDOW_PAGES-1)


if __name__ == "__main__":
    unittest.main()
