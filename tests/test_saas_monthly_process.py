"""Calendar semantics and fail-closed contracts for month-window DB aggregates."""
import unittest
from datetime import datetime,timezone
from unittest.mock import patch
from services.saas_api.monthly_process import month_bounds,_next_review,monthly_process
from services.saas_api.trades import TradeInputError

class MonthlyProcessTests(unittest.TestCase):
    def test_nz_dst_and_asof_cutoff(self):
        now=datetime(2026,10,27,tzinfo=timezone.utc)
        start,end,cutoff=month_bounds("2026-10",now)
        self.assertEqual(start.isoformat(),"2026-09-30T11:00:00+00:00")
        self.assertEqual(end.isoformat(),"2026-10-31T11:00:00+00:00")
        self.assertEqual(cutoff,now)
        start,end,cutoff=month_bounds("2029-04",datetime(2029,5,1,tzinfo=timezone.utc))
        self.assertEqual(start.isoformat(),"2029-03-31T11:00:00+00:00")
        self.assertEqual(end.isoformat(),"2029-04-30T12:00:00+00:00")
        self.assertEqual(cutoff,end)

    def test_month_end_review_preserves_local_calendar(self):
        from zoneinfo import ZoneInfo
        nz=ZoneInfo("Pacific/Auckland")
        at=datetime(2026,1,31,10,tzinfo=nz)
        self.assertEqual(_next_review(at,"MONTHLY").astimezone(nz).day,28)
        self.assertEqual(_next_review(at,"QUARTERLY").astimezone(nz).day,30)
        self.assertIsNone(_next_review(at,"EVENT_DRIVEN"))

    def test_invalid_user_input_refused_before_identity_read(self):
        for month in ("2026-1","2026-13","2026-00","2027-01",
                      "2026-10;DROP TABLE saas_trade_events",None,123):
            with self.subTest(month=month),patch(
               "services.saas_api.monthly_process._confirmed_scope"
            ) as scope,self.assertRaises(TradeInputError):
                monthly_process(None,None,"123456789",month,
                    now=datetime(2026,10,27,tzinfo=timezone.utc))
                scope.assert_not_called()

    def test_forged_tenant_details_are_not_api_parameters(self):
        # Only subject and month are accepted; no account ID / raw query string.
        with self.assertRaises(TypeError):
            monthly_process(None,None,"123456789","2026-10",
                            workspace_id="forged")

if __name__=="__main__":
    unittest.main()
