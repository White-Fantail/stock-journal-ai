"""Offline, synthetic P4 accounting gates: never invent ledger from snapshots."""
import unittest
from dataclasses import replace
from datetime import datetime,timedelta,timezone
from decimal import Decimal
from uuid import uuid4

from services.broker_connectors.contracts import BrokerPosition
from services.broker_connectors.fifo_projection import VerifiedExecution
from services.broker_connectors.reconciliation import (
    AccountEvidence, CertifiedWindow, PositionEvidence, Reconciliation, reconcile,
)

D=Decimal
T=datetime(2026,10,1,tzinfo=timezone.utc)
END=T+timedelta(days=2)


def fill(source="b1",side="BUY",qty="10",price="100",day=0,fee="10",minute=0):
    return VerifiedExecution(source,"TEST",side,D(qty),D(price),"USD",
                             T+timedelta(days=day,minutes=minute),
                             None if fee is None else D(fee),
                             None if fee is None else "USD")


def evidence(*fills,qty="6",start=T,end=END):
    return AccountEvidence(
        workspace_id=uuid4(),account_id=uuid4(),start=start,end=end,
        windows=(CertifiedWindow(start,start+timedelta(days=1),True),
                 CertifiedWindow(start+timedelta(days=1),end,True)),
        executions=tuple(fills),snapshot=PositionEvidence(end,(BrokerPosition("TEST",D(qty),"USD"),),True),
        orders_reconciled=True,cash_activity_reconciled=True,corporate_actions_reconciled=True,
    )


class ReconciliationTests(unittest.TestCase):
    def setUp(self):
        self.buy=fill()
        self.sell=fill("s1","SELL","4","150",day=1,fee="4")
        self.good=evidence(self.buy,self.sell)

    def test_complete_source_and_matching_snapshot(self):
        result=reconcile(self.good)
        self.assertEqual(result.status,"RECONCILED")
        self.assertEqual(result.issue_codes,())
        self.assertEqual(result.positions[0].quantity,D("6"))
        self.assertEqual(result.positions[0].cost_basis,D("606"))
        self.assertEqual(result.positions[0].realized_pnl,D("192"))
        self.assertEqual(result.checked_fills,2)

    def test_replay_is_only_counted_once(self):
        r=reconcile(replace(self.good,executions=(self.buy,self.buy,self.sell)))
        self.assertEqual(r.status,"RECONCILED")
        self.assertEqual((r.checked_fills,r.duplicate_replays),(2,1))

    def test_conflicting_source_identity_blocks_publication(self):
        forged=replace(self.buy,quantity=D("11"))
        r=reconcile(replace(self.good,executions=(self.buy,forged,self.sell)))
        self.assertEqual(r.status,"BLOCKED")
        self.assertIn("SOURCE_VERSION_CONFLICT",r.issue_codes)
        self.assertFalse(r.positions)

    def test_two_distinct_ids_same_economic_fill_is_suspicious(self):
        forged=replace(self.buy,source_id="different")
        r=reconcile(replace(self.good,executions=(self.buy,forged,self.sell)))
        self.assertIn("POTENTIAL_DUPLICATE_FILL",r.issue_codes)
        self.assertEqual(r.positions,())

    def test_gap_overlap_and_partial_windows_block(self):
        broken=(
            (CertifiedWindow(T,T+timedelta(days=1),True),),
            (CertifiedWindow(T,T+timedelta(days=1,hours=1),True),
             CertifiedWindow(T+timedelta(days=1),END,True)),
            (CertifiedWindow(T,T+timedelta(days=1),False),
             CertifiedWindow(T+timedelta(days=1),END,True)),
        )
        for windows in broken:
            with self.subTest(windows=windows):
                r=reconcile(replace(self.good,windows=windows))
                self.assertEqual(r.status,"BLOCKED")
                self.assertFalse(r.positions)
        self.assertIn("HISTORY_COVERAGE_UNVERIFIED",
                      reconcile(replace(self.good,windows=broken[-1])).issue_codes)

    def test_snapshot_is_not_substitute_for_unknown_fills(self):
        r=reconcile(replace(self.good,executions=(),snapshot=self.good.snapshot))
        self.assertIn("POSITION_QUANTITY_MISMATCH",r.issue_codes)
        self.assertFalse(r.positions)
        r=reconcile(replace(self.good,windows=()))
        self.assertIn("HISTORY_GAP",r.issue_codes)
        self.assertFalse(r.positions)

    def test_missing_independent_certificates(self):
        for key,code in (("orders_reconciled","ORDERS_UNVERIFIED"),
                         ("cash_activity_reconciled","CASH_ACTIVITY_UNVERIFIED"),
                         ("corporate_actions_reconciled","CORPORATE_ACTIONS_UNVERIFIED")):
            with self.subTest(key=key):
                r=reconcile(replace(self.good,**{key:False}))
                self.assertIn(code,r.issue_codes)
                self.assertEqual(r.positions,())

    def test_snapshot_must_match_asof_and_quantity(self):
        cases=(
            (None,"SNAPSHOT_UNAVAILABLE"),
            (replace(self.good.snapshot,as_of=END-timedelta(seconds=1)),"SNAPSHOT_ASOF_MISMATCH"),
            (replace(self.good.snapshot,provider_verified=False),"SNAPSHOT_UNVERIFIED"),
            (replace(self.good.snapshot,positions=(BrokerPosition("TEST",D("5"),"USD"),)),
             "POSITION_QUANTITY_MISMATCH"),
            (replace(self.good.snapshot,positions=(
                BrokerPosition("TEST",D("6"),"USD"),
                BrokerPosition("TEST",D("6"),"USD"))),"SNAPSHOT_DUPLICATE_SYMBOL"),
        )
        for snapshot,code in cases:
            with self.subTest(code=code):
                r=reconcile(replace(self.good,snapshot=snapshot))
                self.assertIn(code,r.issue_codes)
                self.assertFalse(r.positions)

    def test_unknown_fee_currency_and_time_block(self):
        for invalid,code in (
            (replace(self.buy,fee=None,fee_currency=None),"FEE_UNKNOWN"),
            (replace(self.buy,fee_currency="NZD"),"FEE_CURRENCY_UNVERIFIED"),
            (replace(self.buy,price=D("NaN")),"INVALID_EXECUTION"),
            (replace(self.buy,occurred_at=END),"EXECUTION_OUT_OF_RANGE"),
            (replace(self.buy,occurred_at=T.replace(tzinfo=None)),"INVALID_EXECUTION"),
        ):
            with self.subTest(code=code):
                r=reconcile(replace(self.good,executions=(invalid,self.sell)))
                self.assertIn(code,r.issue_codes)
                self.assertFalse(r.positions)

    def test_oversell_is_blocked_even_with_matching_snapshot(self):
        r=reconcile(replace(self.good,executions=(self.sell,),snapshot=PositionEvidence(
            END,(),True)))
        self.assertEqual(r.status,"BLOCKED")
        self.assertIn("INSUFFICIENT_OPEN_LOTS",r.issue_codes)

    def test_invalid_account_scope_is_rejected(self):
        with self.assertRaises(TypeError):
            reconcile(replace(self.good,workspace_id="owner"))

    def test_empty_certified_account_and_empty_snapshot_is_valid_zero(self):
        r=reconcile(evidence(qty="0",*()))
        self.assertEqual(r.status,"RECONCILED")
        self.assertFalse(r.positions)

    def test_results_are_account_scoped_inputs_only(self):
        a=reconcile(self.good)
        b=reconcile(replace(self.good,workspace_id=uuid4(),account_id=uuid4(),
                            snapshot=PositionEvidence(END,(),True)))
        self.assertEqual(a.status,"RECONCILED")
        self.assertEqual(b.status,"BLOCKED")
        self.assertNotEqual(a.positions,b.positions)


if __name__=="__main__":
    unittest.main()
