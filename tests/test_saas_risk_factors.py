import unittest
from uuid import uuid4
from services.saas_api.risk_factors import normalize_risk_factors
from services.saas_api.trades import TradeInputError

class RiskFactorValidation(unittest.TestCase):
 def test_manual_overlapping_factors_and_empty_reset(self):
  base={"idempotencyKey":str(uuid4()),"ticker":"TSLA",
    "factors":["HIGH_GROWTH","AI_INFRA"],"rationale":"my subjective tags"}
  r=normalize_risk_factors(base)
  self.assertEqual(r["factors"],["AI_INFRA","HIGH_GROWTH"])
  self.assertEqual(normalize_risk_factors({**base,"factors":[]})["factors"],[])
 def test_invalid_inferred_extra_ids_and_duplicate_factors_refused(self):
  good={"idempotencyKey":str(uuid4()),"ticker":"TSLA",
    "factors":["US_TECH"],"rationale":"user reasoning"}
  invalid=[
    {"factors":["US_TECH","US_TECH"]},{"factors":["UNKNOWN"]},
    {"factors":["US_TECH","HIGH_GROWTH","AI_INFRA","SPACE_DEFENSE"]},
    {"ticker":"../../other"},{"rationale":" "},
    {"rationale":"x"*1501},{"idempotencyKey":"invalid"},
    {"accountId":"forged"},{"workspaceId":"forged"},
  ]
  for change in invalid:
   with self.subTest(change=change),self.assertRaises(TradeInputError):
    normalize_risk_factors({**good,**change})

if __name__=="__main__":
 unittest.main()
