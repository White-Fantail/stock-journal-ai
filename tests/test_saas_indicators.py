import unittest
from uuid import uuid4
from services.saas_api.indicators import normalize_rule, normalize_record, evaluate
from services.saas_api.trades import TradeInputError


def rule(**changes):
    return {"idempotencyKey":str(uuid4()),"ruleId":None,"expectedRevisionId":None,
            "name":"RSI","parameters":"14","timeframe":"일봉","side":"BUY","stage":"CONTEXT",
            "operator":"LTE","lower":"30","upper":None,"condition":"","active":True,**changes}


class IndicatorTests(unittest.TestCase):
    def test_numeric_boundaries_preserve_precision_and_zero(self):
        r=normalize_rule(rule())
        for val,status in [("30","MET"),("30.00000001","NOT_MET"),("0","MET"),(None,"UNCERTAIN")]:
            self.assertEqual(evaluate(r,val,"MET")[0],status)
        r=normalize_rule(rule(name="MACD",operator="BETWEEN",lower="-0.1",upper="0.1"))
        self.assertEqual(evaluate(r,"-0.10000000","UNCERTAIN")[0],"MET")
        self.assertEqual(evaluate(r,"0.10000001","MET")[0],"NOT_MET")
        r=normalize_rule(rule(side="SELL",operator="GTE",lower="70"))
        self.assertEqual(evaluate(r,"70","UNCERTAIN")[0],"MET")
        self.assertEqual(evaluate(r,"69.9","MET")[0],"NOT_MET")

    def test_manual_crossing_never_inferred_from_single_value(self):
        r=normalize_rule(rule(operator="MANUAL",lower=None,condition="30 상향 돌파"))
        self.assertEqual(evaluate(r,"32","UNCERTAIN"),("UNCERTAIN","USER_ASSESSED"))
        self.assertEqual(evaluate(r,None,"MET"),("MET","USER_ASSESSED"))

    def test_bad_rules(self):
        for changes in [{"lower":"NaN"},{"lower":"1e3"},{"lower":True},
                        {"operator":"BETWEEN","upper":"20"},{"operator":"MANUAL","lower":None},
                        {"active":"true"},{"side":[]},{"workspaceId":str(uuid4())},
                        {"name":" "},{"ruleId":str(uuid4())}]:
            with self.subTest(changes=changes),self.assertRaises(TradeInputError):
                normalize_rule(rule(**changes))

    def test_record_bounds_links_timestamp_and_input_precision(self):
        raw={"idempotencyKey":str(uuid4()),"ticker":"QATEST","side":"BUY",
             "observedAt":"2026-10-28T14:30:00+13:00","tradeEventId":None,"journalId":None,
             "note":"","observations":[{"revisionId":str(uuid4()),"value":"0.00000000","assessment":"UNCERTAIN"}]}
        self.assertEqual(normalize_record(raw)["observations"][0]["value"],"0.00000000")
        for changes in [{"observedAt":"2026-10-28T14:30:00"},{"observations":[]},
                        {"observations":raw["observations"]*2},{"side":[]},
                        {"tradeEventId":str(uuid4()),"journalId":str(uuid4())},
                        {"workspaceId":str(uuid4())}]:
            with self.subTest(changes=changes),self.assertRaises(TradeInputError):
                normalize_record({**raw,**changes})

if __name__=="__main__":unittest.main()
