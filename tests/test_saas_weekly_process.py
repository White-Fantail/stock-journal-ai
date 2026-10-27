import unittest
from datetime import datetime,timezone
from unittest.mock import patch
from services.saas_api.weekly_process import week_bounds,weekly_process
from services.saas_api.trades import TradeInputError

class WeeklyWindowTests(unittest.TestCase):
 def test_nz_iso_week_and_dst(self):
  a,b,c=week_bounds("2026-W44",datetime(2026,10,27,tzinfo=timezone.utc))
  self.assertEqual(a.isoformat(),"2026-10-25T11:00:00+00:00")
  self.assertEqual(b.isoformat(),"2026-11-01T11:00:00+00:00")
  self.assertEqual(c,datetime(2026,10,27,tzinfo=timezone.utc))
  a,b,c=week_bounds("2026-W14",datetime(2026,4,20,tzinfo=timezone.utc))
  self.assertEqual(a.isoformat(),"2026-03-29T11:00:00+00:00")
  self.assertEqual(b.isoformat(),"2026-04-05T12:00:00+00:00")
  self.assertEqual(c,b)
 def test_invalid_future_and_bad_iso_week_rejected_before_db(self):
  for value in (None,1,"2026-W00","2026-W54","2026-W5",
                "2026-W53","2026-W52;SELECT", "2027-W02"):
   with self.subTest(value=value),patch(
     "services.saas_api.weekly_process._confirmed_scope") as scope:
    with self.assertRaises(TradeInputError):
     weekly_process(None,None,"123",value,
       now=datetime(2026,10,27,tzinfo=timezone.utc))
    scope.assert_not_called()

if __name__=="__main__":
 unittest.main()
