"""Synthetic precision and fail-closed evidence tests, no live Tiger accounts."""
import unittest
from dataclasses import replace
from datetime import datetime,timezone,timedelta
from uuid import uuid4

from services.broker_connectors.performance_math import (
  ProofWindow,PerformanceModelRefused,model_chained_return,
)

PROOFS=frozenset((
 "START_END_NAV_RECONCILED","EXTERNAL_FLOWS_COMPLETE",
 "FLOW_TIMING_AT_SEGMENT_END",
 "FEES_DIVIDENDS_CORPORATE_ACTIONS_RECONCILED",
 "FX_SAME_CURRENCY_OR_ATTESTED","ACCOUNT_HISTORY_COVERAGE_ATTESTED",
))
ACCOUNT=uuid4()
T0=datetime(2026,1,1,tzinfo=timezone.utc)
T1=datetime(2026,2,1,tzinfo=timezone.utc)
T2=datetime(2026,3,1,tzinfo=timezone.utc)

def period(start=T0,end=T1,opening="100",closing="120",flow="10",account=ACCOUNT,
           currency="USD",checks=PROOFS):
 return ProofWindow(account,currency,start,end,opening,closing,flow,checks)


class PerformanceMathTests(unittest.TestCase):
 def test_exact_chained_two_period_cash_adjusted_result_not_publishable(self):
  outcome=model_chained_return((
   period(),period(T1,T2,"120","114","0"),
  ))
  # (120-10)/100 = 1.10 and (114-0)/120 = .95 -> 4.50%.
  self.assertEqual(outcome.percent,"4.5000")
  self.assertEqual(outcome.periods,2)
  self.assertEqual(outcome.currency,"USD")
  self.assertEqual(outcome.state,"MODEL_ONLY_NOT_PUBLISHABLE")

 def test_contributions_do_not_count_as_investment_return(self):
  outcome=model_chained_return((period(opening="100",closing="200",flow="100"),))
  self.assertEqual(outcome.percent,"0.0000")
  withdrawal=model_chained_return((period(opening="100",closing="100",flow="-10"),))
  self.assertEqual(withdrawal.percent,"10.0000")

 def test_fractional_precision_and_negative_returns_do_not_pass_through_floats(self):
  outcome=model_chained_return((period(opening="100",closing="95",flow="0"),))
  self.assertEqual(outcome.percent,"-5.0000")
  small=model_chained_return((period(opening="1.000000000001",
                                     closing="1.000000000002",flow="0"),))
  self.assertEqual(small.percent,"0.0000")
  self.assertEqual(small.state,"MODEL_ONLY_NOT_PUBLISHABLE")

 def test_no_cashflow_or_evidence_flag_is_ever_sufficiently_verified(self):
  for missing in PROOFS:
   with self.subTest(missing=missing),self.assertRaises(PerformanceModelRefused):
    model_chained_return((period(checks=PROOFS-{missing}),))
  for checks in (frozenset(),frozenset({"START_END_NAV_RECONCILED"}),
                 PROOFS|{"UNREVIEWED_SYNTHETIC_OVERRIDE"}):
   with self.assertRaises(PerformanceModelRefused):
    model_chained_return((period(checks=checks),))

 def test_all_missing_currency_nav_and_gap_cases_fail_closed(self):
  bad=[
   period(currency="NZD") ,
   period(opening="0"),period(opening="-20"),
   period(closing="0"),period(closing="-1"),
   period(closing="5",flow="5"),
   period(opening="NaN"),period(closing="Infinity"),
   period(opening="1e20"),period(flow="1e100"),
   period(opening="1.0000000000001"),
   period(start=T1,end=T0),
   period(start=datetime(2026,1,1),end=T1),
  ]
  for entry in bad[1:]:
   with self.subTest(entry=entry),self.assertRaises(PerformanceModelRefused):
    model_chained_return((entry,))
  for sequence in [
   (period(),replace(period(T1,T2,"120","115","0"),account_id=uuid4())),
   (period(),period(T1+timedelta(seconds=1),T2,"120","115","0")),
   (period(),period(T1-timedelta(seconds=1),T2,"120","115","0")),
   (period(),period(T1,T2,"119","115","0")),
   (period(),period(T1,T2,"120","115","0",currency="NZD")),
  ]:
   with self.subTest(sequence=sequence),self.assertRaises(PerformanceModelRefused):
    model_chained_return(sequence)
  with self.assertRaises(PerformanceModelRefused):
   model_chained_return(())

 def test_broker_data_view_cannot_implicitly_call_performance_engine(self):
  from pathlib import Path
  root=Path(__file__).resolve().parents[1]
  web=(root/"apps/web/app/private").rglob("*.tsx")
  for file in web:
   self.assertNotIn("model_chained_return",file.read_text(encoding="utf-8"))
  # The engine deliberately does not expose an HTTP view or sign evidence.
  src=(root/"services/broker_connectors/performance_math.py").read_text(encoding="utf-8")
  self.assertNotIn("FastAPI",src)
  self.assertNotIn("get_fund_details(",src)
  self.assertNotIn("TradeClient(",src)


if __name__=="__main__":
 unittest.main()
