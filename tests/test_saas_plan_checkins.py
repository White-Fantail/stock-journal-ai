"""Synthetic safety tests for opt-in, append-only self review of plans."""
import unittest
from uuid import uuid4

from services.saas_api.plan_checkins import normalize_checkin
from services.saas_api.trades import TradeInputError

BASE={
 "idempotencyKey":str(uuid4()),"ticker":"TEST",
 "expectedPlanRevisionId":str(uuid4()),
 "selfAssessment":"FOLLOWED",
 "content":"  Stayed with documented criteria  ",
 "nextAction":"  Review quarterly business statements  ",
}


class PlanCheckinContractTests(unittest.TestCase):
 def test_all_self_assessments_are_user_only_and_trimmed(self):
  for status in ("FOLLOWED","PARTIAL","DEVIATED","UNCERTAIN"):
   item=normalize_checkin({**BASE,"selfAssessment":status})
   self.assertEqual(item["selfAssessment"],status)
   self.assertEqual(item["content"],"Stayed with documented criteria")
   self.assertEqual(item["nextAction"],"Review quarterly business statements")
  self.assertEqual(len(normalize_checkin(BASE)),6)

 def test_unknown_plan_foreign_scope_or_trade_order_fields_refused(self):
  for change in (
   {"workspaceId":str(uuid4())},{"accountId":str(uuid4())},
   {"planRevisionId":str(uuid4())},{"brokerFill":True},
   {"score":100},{"selfAssessment":"VERIFIED"},
   {"selfAssessment":"BOUGHT"},{"selfAssessment":None},
   {"content":""},{"content":"  "},{"content":"a"*6001},
   {"nextAction":""},{"nextAction":"x"*1501},
   {"expectedPlanRevisionId":"bad"},{"ticker":"../../file"},
   {"idempotencyKey":"bad"},{"tradeSide":"SELL"}
  ):
   with self.subTest(change=change),self.assertRaises(TradeInputError):
    normalize_checkin({**BASE,**change})

 def test_exact_input_set_and_idempotency_replay_shape(self):
  with self.assertRaises(TradeInputError):
   normalize_checkin({k:v for k,v in BASE.items() if k!="nextAction"})
  self.assertEqual(normalize_checkin(BASE),normalize_checkin(BASE))


if __name__=="__main__":
 unittest.main()
