import unittest
from uuid import uuid4
from services.saas_api.action_followups import normalize_followup
from services.saas_api.trades import TradeInputError

class ActionFollowupValidation(unittest.TestCase):
 def test_explicit_states_and_optional_note(self):
  a={"idempotencyKey":str(uuid4()),"checkinId":str(uuid4()),"state":"DONE","note":None}
  self.assertEqual(normalize_followup(a)["state"],"DONE")
  for state in ("NOT_DONE","NOT_APPLICABLE","UNCERTAIN"):
   self.assertEqual(normalize_followup({**a,"state":state})["state"],state)
 def test_owner_selector_not_allowed_and_notes_bounded(self):
  a={"idempotencyKey":str(uuid4()),"checkinId":str(uuid4()),"state":"DONE","note":None}
  for delta in ({"workspaceId":str(uuid4())},{"state":"AUTO_COMPLETED"},
      {"checkinId":"TSLA"},{"idempotencyKey":"notuuid"},{"note":"x"*1001},{"note":" "}):
   with self.subTest(delta=delta),self.assertRaises(TradeInputError):
    normalize_followup({**a,**delta})
if __name__=="__main__":unittest.main()
