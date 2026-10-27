import unittest
from uuid import uuid4
from services.saas_api.investor_principles import normalize_principles
from services.saas_api.trades import TradeInputError

class InvestorPrinciplesTests(unittest.TestCase):
 def base(self):
  return {"idempotencyKey":str(uuid4()),"objective":"GROWTH","horizon":"OVER_TEN_YEARS",
          "baseCurrency":"NZD","maxSinglePct":"15.0","riskLimitPct":None,
          "reviewCadence":"QUARTERLY","note":"My own investment objective"}
 def test_values_and_explicit_reset(self):
  self.assertEqual(normalize_principles(self.base())["maxSinglePct"],"15.0")
  base=self.base()
  reset={k:None for k in base if k!="idempotencyKey"}
  self.assertIsNone(normalize_principles({"idempotencyKey":str(uuid4()),**reset})["objective"])
 def test_untrusted_fields_rejected(self):
  base=self.base()
  for changed in ({"objective":"BUY_NOW"},{"baseCurrency":"US$"},
                  {"maxSinglePct":"0"},{"riskLimitPct":"120"},{"riskLimitPct":"nan"},
                  {"note":"x"*1501},{"workspaceId":str(uuid4())},
                  {"reviewCadence":"DAILY"},{"idempotencyKey":"invalid"}):
   with self.subTest(changed=changed), self.assertRaises(TradeInputError):
    normalize_principles({**base,**changed})
if __name__=="__main__":unittest.main()
