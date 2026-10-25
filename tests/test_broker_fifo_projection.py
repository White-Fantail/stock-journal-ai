"""Synthetic, source-complete native-currency FIFO only; no live account data."""
import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4
from services.broker_connectors.fifo_projection import (
    AccountExecutions, VerifiedExecution, project_fifo,
)

D=Decimal
T=datetime(2026,10,20,10,tzinfo=timezone.utc)


def fill(source_id, side, quantity, price, minute, fee="0", currency="USD", fee_currency="USD"):
    return VerifiedExecution(source_id,"TEST",side,D(quantity),D(price),
                             currency,T+timedelta(minutes=minute),
                             D(fee) if fee is not None else None,
                             fee_currency if fee is not None else None)


class ProjectionTests(unittest.TestCase):
    def setUp(self):
        self.workspace,self.account=uuid4(),uuid4()

    def account_fills(self, *fills, history=True, corp=True):
        return AccountExecutions(self.workspace,self.account,history,corp,tuple(fills))

    def test_fifo_multi_lot_partial_sell_and_fee_allocation(self):
        ledger=self.account_fills(fill("b1","BUY","10","100",0,"10"),
                                  fill("b2","BUY","5","120",1,"5"),
                                  fill("s1","SELL","12","150",2,"12"))
        result=project_fifo(ledger)
        self.assertEqual(result.status,"CALCULATED")
        p=result.positions[0]
        self.assertEqual(p.quantity,D("3"))
        self.assertEqual(p.cost_basis,D("363"))  # 3 * (120 + 5/5)
        self.assertEqual(p.realized_pnl,D("536"))  # 10*(150-1-101)+2*(150-1-121)

    def test_replay_same_fill_is_idempotent(self):
        f=fill("b1","BUY","2","10",0,"0")
        self.assertEqual(project_fifo(self.account_fills(f,f)).positions[0].quantity,D("2"))

    def test_conflicting_source_id_fails_closed(self):
        r=project_fifo(self.account_fills(fill("b","BUY","2","10",0),
                                           fill("b","BUY","3","10",1)))
        self.assertEqual((r.status,r.issue_codes),("UNAVAILABLE",("CONFLICTING_SOURCE_VERSION",)))
        self.assertFalse(r.positions)

    def test_unknown_fee_never_becomes_zero(self):
        r=project_fifo(self.account_fills(fill("b","BUY","2","10",0,None),
                                           fill("s","SELL","1","15",1,"1")))
        self.assertEqual(r.status,"REVIEW_REQUIRED")
        self.assertEqual(r.positions[0].quantity,D("1"))
        self.assertIsNone(r.positions[0].cost_basis)
        self.assertIsNone(r.positions[0].realized_pnl)
        self.assertIn("FEE_UNKNOWN",r.issue_codes)

    def test_unknown_sell_fee_invalidates_realized_only(self):
        r=project_fifo(self.account_fills(fill("b","BUY","2","10",0,"1"),
                                           fill("s","SELL","1","15",1,None)))
        self.assertEqual(r.positions[0].cost_basis,D("10.5"))
        self.assertIsNone(r.positions[0].realized_pnl)

    def test_unverified_history_or_corporate_actions_never_yield_zero_holdings(self):
        for history,corp in ((False,True),(True,False)):
            r=project_fifo(self.account_fills(history=history,corp=corp))
            self.assertEqual(r.status,"UNAVAILABLE")
            self.assertFalse(r.positions)

    def test_unverified_fee_currency_and_timestamp_denied(self):
        wrong=fill("b","BUY","1","10",0,"1",fee_currency="NZD")
        self.assertEqual(project_fifo(self.account_fills(wrong)).status,"UNAVAILABLE")
        missing=VerifiedExecution("b","TEST","BUY",D("1"),D("10"),"USD",
                                  datetime(2026,10,20),D("0"),"USD")
        self.assertEqual(project_fifo(self.account_fills(missing)).status,"UNAVAILABLE")

    def test_oversell_and_ambiguous_ties_denied(self):
        r=project_fifo(self.account_fills(fill("s","SELL","1","10",0)))
        self.assertEqual(r.issue_codes,("INSUFFICIENT_OPEN_LOTS",))
        r=project_fifo(self.account_fills(fill("b1","BUY","1","10",0),
                                           fill("b2","BUY","1","11",0)))
        self.assertEqual(r.issue_codes,("AMBIGUOUS_FILL_SEQUENCE",))

    def test_separate_accounts_do_not_share_lots(self):
        buy=fill("b","BUY","1","10",0)
        sell=fill("s","SELL","1","11",1)
        self.assertEqual(project_fifo(self.account_fills(sell)).status,"UNAVAILABLE")
        self.assertEqual(project_fifo(self.account_fills(buy,sell)).status,"CALCULATED")


if __name__=="__main__":
    unittest.main()
