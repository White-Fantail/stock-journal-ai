"""Owner RSA financial-activity diagnostic tests (synthetic source only)."""
import unittest
from datetime import datetime,timezone
from unittest.mock import patch
from temporary.tiger_personal.fund_probe_worker import (
    run_fund_probe,PersonalFundsProbeRefused,
)

OWNER_ENV={
  "POSITIONARY_PERSONAL_FUND_PROBE_ENABLED":"1",
  "POSITIONARY_PERSONAL_TIGER_ENABLED":"1",
  "POSITIONARY_PERSONAL_GOOGLE_SUBJECT":"1234567890",
}
NOW=datetime(2026,10,27,0,0,0,tzinfo=timezone.utc)


def event(**extra):
    row={"id":991,"type":"Deposit","seg_type":"SEC","currency":"USD",
         "amount":125.5,"business_date":"2026-10-25",
         "updated_at":1792886400000,
         "page":1,"limit":50,"item_count":1,"page_count":1}
    row.update(extra)
    return row


class Source:
    def __init__(self,kind="SUCCESS"):
        self.calls=[]
        self.kind=kind

    def get_fund_details(self,**kwargs):
        self.calls.append(kwargs)
        if self.kind=="RAISE":
            raise RuntimeError("private account secret should never show")
        if self.kind=="EMPTY":
            return []
        if self.kind=="BAD":
            return [event(account="other",amount="NaN")]
        return [event()]


class OwnerFundsProbeTests(unittest.TestCase):
    def setup_call(self,env=None,source=None):
        source=source or Source()
        seen=[]
        def factory(tiger_id,account,key):
            seen.append((tiger_id,account,key))
            return source
        with patch("temporary.tiger_personal.fund_probe_worker.configuration",
                   return_value=("test-tiger-id","ABC12345","private-rsa-test")):
            result=run_fund_probe(OWNER_ENV if env is None else env,
                                   client_factory=factory,now=NOW)
        return result,source,seen

    def test_owner_opt_in_and_three_read_only_account_bound_queries(self):
        r,source,seen=self.setup_call()
        self.assertEqual(r["source"],"OWNER_ONLY_RSA_SHADOW_PROBE")
        self.assertIs(r["verified"],False)
        self.assertIs(r["historyComplete"],False)
        self.assertEqual(len(r["checks"]),3)
        self.assertEqual(seen,[("test-tiger-id","ABC12345","private-rsa-test")])
        self.assertEqual([x["fund_type"] for x in source.calls],
            ["DEPOSIT_WITHDRAW","FOREX","CORPORATE_ACTION"])
        self.assertTrue(all(x["account"]=="ABC12345" for x in source.calls))
        self.assertTrue(all(x["start_date"]=="2026-10-20" for x in source.calls))
        self.assertTrue(all(x["end_date"]=="2026-10-26" for x in source.calls))
        self.assertEqual([x["limit"] for x in source.calls],[50,50,50])
        self.assertEqual([x["start"] for x in source.calls],[0,0,0])
        self.assertTrue(all(x["status"]=="SHAPE_OBSERVED_UNVERIFIED"
                            for x in r["checks"]))
        # Neither raw IDs nor amounts nor credentials appear in returned metadata.
        self.assertNotIn("991",str(r))
        self.assertNotIn("125.5",str(r))
        self.assertNotIn("ABC12345",str(r))
        self.assertNotIn("private-rsa-test",str(r))

    def test_no_opt_in_or_owner_blocks_before_rsa_credentials_or_network(self):
        for env in (
            {**OWNER_ENV,"POSITIONARY_PERSONAL_FUND_PROBE_ENABLED":"0"},
            {**OWNER_ENV,"POSITIONARY_PERSONAL_GOOGLE_SUBJECT":""},
            {**OWNER_ENV,"POSITIONARY_PERSONAL_GOOGLE_SUBJECT":"forged"},
        ):
            with self.subTest(env=env),patch(
                "temporary.tiger_personal.fund_probe_worker.configuration"
            ) as config,self.assertRaises(PersonalFundsProbeRefused):
                run_fund_probe(env,client_factory=lambda *a:self.fail(
                    "No provider access before owner check"),now=NOW)
                config.assert_not_called()

    def test_nonvalidated_sdk_response_does_not_emit_money(self):
        for kind,status in [
            ("EMPTY","NO_ROWS_UNVERIFIED"),
            ("RAISE","PROVIDER_UNAVAILABLE"),
            ("BAD","SOURCE_SHAPE_UNVERIFIED"),
        ]:
            with self.subTest(kind=kind):
                result,source,_=self.setup_call(source=Source(kind))
                self.assertTrue(all(x["status"]==status for x in result["checks"]))
                self.assertFalse(result["verified"])
                self.assertNotIn("secret",str(result))
                self.assertNotIn("NaN",str(result))

    def test_invalid_rsa_config_and_time_are_sanitized(self):
        with patch("temporary.tiger_personal.fund_probe_worker.configuration",
                   side_effect=ValueError("private user secret")):
            with self.assertRaises(PersonalFundsProbeRefused) as ctx:
                run_fund_probe(OWNER_ENV,now=NOW)
        self.assertEqual(str(ctx.exception),"RSA_CONFIGURATION_UNAVAILABLE")
        with self.assertRaises(PersonalFundsProbeRefused):
            run_fund_probe(OWNER_ENV,now=datetime(2026,10,27))


if __name__=="__main__":
    unittest.main()
