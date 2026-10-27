"""Synthetic offline coverage and source-provenance tests; no live Tiger API."""
import unittest
from dataclasses import replace
from datetime import date,timedelta
from uuid import uuid4

from services.broker_connectors.tiger_financial_evidence import (
    CATEGORIES,FundEvidenceUnavailable,collect_fund_observations,
)
from services.broker_connectors.tiger_financial_coverage import (
    plan_fund_windows,assess_financial_coverage,
)

KEY=b"test-only-nonproduction-cryptographic-secret-123456"
WORKSPACE,ACCOUNT=uuid4(),uuid4()
ACCOUNT_LABEL="SYNTH12345"


class OneRow:
    def __init__(self,business_date):
        self.date=business_date
    def get_fund_details(self,**kwargs):
        return [{
            "id":12345,"type":"Commission","seg_type":"FUND",
            "currency":"USD","amount":-1.25,"business_date":self.date,
            "updated_at":1791388800000,
            "page":1,"limit":50,"item_count":1,"page_count":1,
        }]


def batch(window,category):
    return collect_fund_observations(
        OneRow(window.start.isoformat()),window,category,
        account=ACCOUNT_LABEL,hmac_secret=KEY
    )


class FinancialCoverageTests(unittest.TestCase):
    def test_bounded_overlapping_windows_include_every_day(self):
        windows=plan_fund_windows(WORKSPACE,ACCOUNT,
            date(2026,1,1),date(2026,7,1))
        self.assertGreater(len(windows),2)
        self.assertTrue(all((w.end-w.start).days<=85 for w in windows))
        self.assertEqual(windows[0].start,date(2026,1,1))
        self.assertEqual(windows[-1].end,date(2026,7,1))
        for a,b in zip(windows,windows[1:]):
            self.assertEqual(b.start,a.end-timedelta(days=1))
        self.assertTrue(all(w.account_id==ACCOUNT for w in windows))

    def test_full_shape_coverage_is_still_not_a_broker_accounting_ledger(self):
        windows=plan_fund_windows(WORKSPACE,ACCOUNT,
           date(2026,10,1),date(2026,10,20))
        batches=tuple(batch(w,c) for w in windows for c in CATEGORIES)
        outcome=assess_financial_coverage(windows,batches)
        self.assertEqual(outcome.state,"SHAPE_OBSERVED_HISTORY_UNVERIFIED")
        self.assertEqual(outcome.categories,len(CATEGORIES))
        self.assertEqual(outcome.observed_records,len(CATEGORIES))
        for value in (
           outcome.history_certified,outcome.fees_reconciled,
           outcome.deposits_reconciled,outcome.corporate_actions_reconciled,
           outcome.fx_reconciled,outcome.total_returns_available,
        ):
            self.assertIs(value,False)

    def test_partial_category_does_not_pretend_history_coverage(self):
        windows=plan_fund_windows(WORKSPACE,ACCOUNT,
            date(2026,1,1),date(2026,6,1))
        subset=tuple(batch(w,c) for w in windows for c in CATEGORIES[:-1])
        outcome=assess_financial_coverage(windows,subset)
        self.assertEqual(outcome.state,"PARTIAL_HISTORY_UNVERIFIED")
        self.assertEqual(outcome.categories,len(windows)*(len(CATEGORIES)-1))

    def test_reject_duplicate_batches_cross_tenant_and_missing_days(self):
        windows=plan_fund_windows(WORKSPACE,ACCOUNT,
            date(2026,10,1),date(2026,10,27))
        c=batch(windows[0],CATEGORIES[0])
        for items in [(c,c),]:
            with self.assertRaises(FundEvidenceUnavailable):
                assess_financial_coverage(windows,items)
        foreign=replace(windows[0],account_id=uuid4())
        with self.assertRaises(FundEvidenceUnavailable):
            assess_financial_coverage(windows,(batch(foreign,CATEGORIES[0]),))
        broken=(windows[0],replace(windows[0],start=date(2026,10,3)))
        with self.assertRaises(FundEvidenceUnavailable):
            assess_financial_coverage(broken,())

    def test_no_unbounded_or_invalid_future_history_range(self):
        for start,end in [
            (date(2026,10,1),date(2026,10,1)),
            (date(2026,10,2),date(2026,10,1)),
            (date(2000,1,1),date(2026,1,1)),
            (date(1999,12,31),date(2000,1,2)),
        ]:
            with self.subTest(start=start,end=end),self.assertRaises(FundEvidenceUnavailable):
                plan_fund_windows(WORKSPACE,ACCOUNT,start,end)


if __name__=="__main__":
    unittest.main()
