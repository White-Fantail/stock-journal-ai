"""Pure tests for documented Tiger fund-detail observation contract.

All IDs, currencies, amounts and dates are artificial. No real owner account,
RSA keys, direct broker calls, private statements or OAuth token is used.
"""
import unittest
from dataclasses import replace
from datetime import date
from uuid import uuid4

from services.broker_connectors.tiger_financial_evidence import (
    FundWindow, FundEvidenceUnavailable, collect_fund_observations,
)

KEY=b"synthetic-only-hmac-key-abcdef-0123456789abcdef"
WINDOW=FundWindow(uuid4(),uuid4(),date(2026,10,1),date(2026,10,31))


def row(identity: int, **patch):
    value={"id":identity,"type":"Deposit","seg_type":"SEC",
           "currency":"USD","amount":125.23,"business_date":"2026-10-07",
           "updated_at":1791388800000,
           "page":1,"limit":50,"item_count":1,"page_count":1}
    value.update(patch)
    return value


class FakeSource:
    def __init__(self, responses):
        self.responses=responses
        self.calls=[]

    def get_fund_details(self, **kwargs):
        self.calls.append(kwargs)
        return self.responses[kwargs["start"]//50]


class BrokenSource:
    def get_fund_details(self, **kwargs):
        raise RuntimeError("should never leak a sensitive provider exception")


class FakeFrame:
    def __init__(self,rows):self._data=rows

    def to_dict(self,orient):
        assert orient=="records"
        return self._data


class TigerFundEvidenceTests(unittest.TestCase):
    def test_success_is_still_unverified(self):
        source=FakeSource([FakeFrame([row(101)])])
        batch=collect_fund_observations(source,WINDOW,"DEPOSIT_WITHDRAW",hmac_secret=KEY)
        self.assertEqual(batch.state,"SHADOW_OBSERVED_ONLY")
        self.assertFalse(batch.history_certified)
        self.assertEqual(len(batch.records),1)
        e=batch.records[0]
        self.assertEqual(e.amount,"125.23")
        self.assertEqual(e.provider_type,"Deposit")
        self.assertEqual(e.filter_category,"DEPOSIT_WITHDRAW")
        self.assertFalse(e.amount_precision_verified)
        self.assertEqual(e.provenance,"BROKER_OBSERVED_UNVERIFIED")
        self.assertEqual(len(e.source_ref),64)
        self.assertNotIn("101",e.source_ref)
        self.assertEqual(source.calls,[{
            "seg_types":["SEC","FUT"],"fund_type":"DEPOSIT_WITHDRAW",
            "start":0,"limit":50,
            "start_date":"2026-10-01","end_date":"2026-10-31"}])

    def test_all_three_documented_categories_remain_unverified(self):
        for category in ("DEPOSIT_WITHDRAW","FOREX","CORPORATE_ACTION"):
            batch=collect_fund_observations(FakeSource([[row(77)]]),WINDOW,
                                            category,hmac_secret=KEY)
            self.assertEqual(batch.category,category)
            self.assertFalse(batch.history_certified)
            self.assertEqual(batch.records[0].filter_category,category)

    def test_pagination_all_records_accounted_before_accepting(self):
        first=[row(i,page=1,item_count=51,page_count=2)
               for i in range(1000,1050)]
        last=[row(1050,page=2,item_count=51,page_count=2)]
        source=FakeSource([first,last])
        batch=collect_fund_observations(source,WINDOW,"FOREX",hmac_secret=KEY)
        self.assertEqual(len(batch.records),51)
        self.assertEqual(batch.pages,2)
        self.assertEqual([x["start"] for x in source.calls],[0,50])
        self.assertEqual(len({x.source_ref for x in batch.records}),51)

    def test_owner_scope_changes_hmac_source_reference(self):
        original=collect_fund_observations(FakeSource([[row(99)]]),WINDOW,
                   "CORPORATE_ACTION",hmac_secret=KEY).records[0]
        other=collect_fund_observations(FakeSource([[row(99)]]),
                 replace(WINDOW,account_id=uuid4()),
                 "CORPORATE_ACTION",hmac_secret=KEY).records[0]
        self.assertNotEqual(original.source_ref,other.source_ref)
        self.assertEqual(original.evidence_sha256,other.evidence_sha256)

    def test_invalid_metadata_and_partial_results_refused(self):
        cases=[
          [row(1,item_count=2)],
          [row(1,page=2)],
          [row(1,limit=100)],
          [row(1,item_count=100,page_count=2)],
          [row(1,page_count=21,item_count=1010)],
          [row(1),row(1)],
          [row(1),row(1,amount="99")],
          [row(1,amount="NaN")],
          [row(1,amount=float("inf"))],
          [row(1,currency="INVALID")],
          [row(1,seg_type="FUTURES")],
          [row(1,business_date="2026-10-31")],
          [row(1,business_date="2026-02-30")],
          [row(1,id="not-a-number")],
          [row(1,type="\nsecret")],
          [row(1,page="1")],
          [row(1,updated_at="sensitive")],
          [],
        ]
        for rows in cases:
            with self.subTest(row=rows[0] if rows else None):
                with self.assertRaises(FundEvidenceUnavailable):
                    collect_fund_observations(FakeSource([rows]),WINDOW,
                        "DEPOSIT_WITHDRAW",hmac_secret=KEY)

    def test_window_and_access_cannot_be_supplied_as_freeform_or_forged(self):
        with self.assertRaises(FundEvidenceUnavailable):
            FundWindow("forged",uuid4(),date(2026,10,1),date(2026,10,2))
        with self.assertRaises(FundEvidenceUnavailable):
            FundWindow(uuid4(),uuid4(),date(2026,10,1),date(2026,10,1))
        with self.assertRaises(FundEvidenceUnavailable):
            collect_fund_observations(FakeSource([[row(1)]]),WINDOW,
                                      "TRADE",hmac_secret=KEY)
        with self.assertRaises(FundEvidenceUnavailable):
            collect_fund_observations(FakeSource([[row(1)]]),WINDOW,
                                      "FOREX",hmac_secret=b"weak")

    def test_failures_have_sanitized_error_codes_only(self):
        with self.assertRaises(FundEvidenceUnavailable) as ctx:
            collect_fund_observations(BrokenSource(),WINDOW,
                "DEPOSIT_WITHDRAW",hmac_secret=KEY)
        self.assertEqual(str(ctx.exception),"PROVIDER_READ_FAILED")
        self.assertNotIn("sensitive",str(ctx.exception))


if __name__=="__main__":
    unittest.main()
