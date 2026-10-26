"""Synthetic-only quote availability, Decimal maths and owner isolation tests."""
import os
import unittest
from datetime import datetime,timezone,timedelta
from types import SimpleNamespace
from unittest.mock import patch

from temporary.tiger_personal import market_quotes, market_quotes_worker
from temporary.tiger_personal.api import PilotError

NOW=1793000000000
OWNER="1234567890"
ENV={"POSITIONARY_PERSONAL_TIGER_ENABLED":"1","POSITIONARY_PERSONAL_GOOGLE_SUBJECT":OWNER}
POSITIONS=[{"symbol":"TSLA","currency":"USD","quantity":"1.5","averageCost":"200",
            "marketValue":"310","unrealizedPnl":"10"},
           {"symbol":"HKEX","currency":"HKD","quantity":"2","averageCost":"100",
            "marketValue":None,"unrealizedPnl":None}]


class QuoteSourceTests(unittest.TestCase):
    def test_delayed_quote_is_us_only_and_currency_not_inferred_from_hkd(self):
        class Client:
            def __init__(self):self.calls=[]
            def get_stock_delay_briefs(self,symbols):
                self.calls.append(symbols)
                return [{"symbol":"TSLA","close":210.25,"time":NOW-900000}]
            def get_stock_briefs(self,*args,**kwargs):
                raise RuntimeError("NO_MARKET_PERMISSION")
            def place_order(self,*args,**kwargs):
                raise AssertionError("ORDER_FORBIDDEN")
        c=Client()
        rows,status=market_quotes_worker.collect_quotes(c,POSITIONS,NOW)
        self.assertEqual(status,"OBSERVED")
        self.assertEqual(c.calls,[["TSLA"]])
        self.assertEqual(rows,[{"symbol":"TSLA","currency":"USD","price":"210.25",
                "quoteAt":str(NOW-900000),"mode":"US_DELAYED_15M"}])

    def test_permissioned_realtime_upgrade_never_uses_older_quote(self):
        class Client:
            def __init__(self,latest): self.latest=latest
            def get_stock_delay_briefs(self,symbols):
                return [{"symbol":"TSLA","close":210,"time":NOW-1200000}]
            def get_stock_briefs(self,symbols,include_hour_trading):
                self.enabled=include_hour_trading
                return [{"symbol":"TSLA","latest_price":215,"latest_time":self.latest}]
        a,_=market_quotes_worker.collect_quotes(Client(NOW-60000),POSITIONS,NOW)
        self.assertEqual(a[0]["mode"],"REALTIME_PERMISSIONED")
        self.assertEqual(a[0]["price"],"215")
        b,_=market_quotes_worker.collect_quotes(Client(NOW-1300000),POSITIONS,NOW)
        self.assertEqual(b[0]["mode"],"US_DELAYED_15M")

    def test_invalid_duplicate_future_symbol_response_fails(self):
        class Client:
            def __init__(self,rows): self.rows=rows
            def get_stock_delay_briefs(self,symbols): return self.rows
        for rows in (
            [{"symbol":"OTHER","close":200,"time":NOW}],
            [{"symbol":"TSLA","close":0,"time":NOW}],
            [{"symbol":"TSLA","close":100,"time":NOW+600000}],
            [{"symbol":"TSLA","close":100,"time":NOW},
             {"symbol":"TSLA","close":110,"time":NOW}],
        ):
            with self.subTest(rows=rows):
                with self.assertRaises(ValueError):
                    market_quotes_worker.collect_quotes(Client(rows),POSITIONS,NOW)

    def test_cost_basis_math_is_provisional_and_staleness_blocks(self):
        q={"symbol":"TSLA","currency":"USD","price":"210.25",
           "quoteAt":str(NOW-900000),"mode":"US_DELAYED_15M"}
        record=market_quotes.indicative_quote(POSITIONS[0],q,NOW,NOW-3600000)
        self.assertEqual(record["estimatedValue"],"315.375")
        self.assertEqual(record["estimatedUnrealized"],"15.375")
        self.assertEqual(record["estimatedReturnPct"],"5.12")
        self.assertFalse(record["stale"])
        self.assertIsNone(market_quotes.indicative_quote(POSITIONS[0],q,NOW,NOW-72*3600000)["estimatedUnrealized"])
        self.assertIsNone(market_quotes.indicative_quote({**POSITIONS[0],"averageCost":None},q,NOW,NOW-3600000)["estimatedValue"])
        self.assertIsNone(market_quotes.indicative_quote({**POSITIONS[0],"currency":"HKD"},q,NOW,NOW-3600000))
        self.assertIsNone(market_quotes.indicative_quote({**POSITIONS[0],"quantity":"-1"},q,NOW,NOW-3600000)["estimatedReturnPct"])

    def test_ingress_requires_pinned_subject_us_quote_and_time(self):
        now=int(datetime.now(timezone.utc).timestamp()*1000)
        row={"subject":OWNER,"account":"U12345678",
             "quotes":[{"symbol":"TSLA","currency":"USD","price":"200.12",
                         "quoteAt":str(now-900000),"mode":"US_DELAYED_15M"}]}
        with patch.dict(os.environ,ENV,clear=True):
            self.assertEqual(market_quotes._payload(row)[0],"U12345678")
            forged=[
              {**row,"subject":"99999999"},
              {**row,"workspaceId":"cross-tenant"},
              {**row,"quotes":[{**row["quotes"][0],"price":"NaN"}]},
              {**row,"quotes":[{**row["quotes"][0],"price":"0"}]},
              {**row,"quotes":[{**row["quotes"][0],"currency":"NZD"}]},
              {**row,"quotes":[{**row["quotes"][0],"quoteAt":str(now+600000)}]},
              {**row,"quotes":[{**row["quotes"][0],"mode":"UNVERIFIED"}]},
              {**row,"quotes":[row["quotes"][0],row["quotes"][0]]},
            ]
            for payload in forged:
                with self.subTest(payload=payload):
                    with self.assertRaises(PilotError):
                        market_quotes._payload(payload)
        with patch.dict(os.environ,{},clear=True):
            with self.assertRaises(PilotError):
                market_quotes._payload(row)


if __name__=="__main__":
    unittest.main()
