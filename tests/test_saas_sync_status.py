"""Processing progress does not certify historic coverage."""
import unittest
from datetime import datetime,timezone
from uuid import uuid4
from services.saas_api.sync_status import _format_job,_issues

T=datetime(2026,1,1,tzinfo=timezone.utc)
def job(state="PARTIAL"):
    return (uuid4(),uuid4(),"Tiger test",state,T,T,T,"CONNECTED")

class SyncHealthTests(unittest.TestCase):
    def test_terminal_page_without_verified_history(self):
        rows=[
          (0,"PARTIAL",0,2,T,None,None,["HISTORY_COVERAGE_UNVERIFIED"]),
          (1,"PENDING",0,0,None,None,None,[])
        ]
        status=_format_job(job(),rows)
        self.assertEqual(status["processedWindows"],1)
        self.assertEqual(status["certifiedWindows"],0)
        self.assertEqual(status["pagesStaged"],2)
        self.assertIs(status["historyVerified"],False)
        self.assertEqual(status["coverage"],"UNVERIFIED")
        self.assertNotIn("checkpoint",str(status).lower())

    def test_nonterminal_partial_not_processed(self):
        rows=[(0,"PARTIAL",0,1,None,T,b"encrypted",["PROVIDER_TRANSIENT"])]
        status=_format_job(job(),rows)
        self.assertEqual(status["processedWindows"],0)
        self.assertEqual(status["nextRetryAt"],T.isoformat())

    def test_no_windows_not_complete(self):
        status=_format_job(job("COMPLETE"),[])
        self.assertEqual(status["totalWindows"],0)
        self.assertEqual(status["processedWindows"],0)
        self.assertIs(status["historyVerified"],False)

    def test_issue_codes_allowlist(self):
        self.assertEqual(_issues(["KNOWN","SENSITIVE:this is a token","KNOWN","BAD\nID",19]),["KNOWN"])

if __name__=="__main__":
    unittest.main()
