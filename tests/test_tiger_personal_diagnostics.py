"""The personal Tiger incident readout is non-mutating and owner scoped."""
import unittest
from contextlib import nullcontext
from unittest.mock import patch
from temporary.tiger_personal import diagnostics
from temporary.tiger_personal.api import PilotError


class _Result:
    def __init__(self, value):
        self.value=value
    def fetchall(self):
        return self.value
    def fetchone(self):
        return self.value


class _Broker:
    def __init__(self):
        self.queries=[]
    def transaction(self):
        return nullcontext()
    def execute(self, statement, args):
        self.queries.append((statement, args))
        if "auth_mode, status, count" in statement:
            return _Result([("SIGNATURE", "PENDING_AUTH", 1)])
        if "SELECT count(*) FROM saas_broker_accounts" in statement:
            return _Result((1,))
        if "SELECT kind, count(*)" in statement:
            return _Result([("ASSETS", 2),("TRANSACTIONS", 17)])
        raise AssertionError("unexpected database query")


class PersonalTigerDiagnosticsTests(unittest.TestCase):
    def test_owner_gets_counts_not_source_data(self):
        b=_Broker()
        with patch.object(diagnostics,"owner_only") as owner, patch.object(
            diagnostics,"_scope",return_value="workspace-id"
        ) as scope:
            result=diagnostics.view_diagnostics(object(),b,"123456789")
        owner.assert_called_once_with("123456789")
        scope.assert_called_once()
        self.assertEqual(result["accountCount"],1)
        self.assertEqual(result["pilotReadableAccountCount"],1)
        self.assertEqual(result["snapshotCounts"],
                         [{"kind":"ASSETS","count":2},{"kind":"TRANSACTIONS","count":17}])
        self.assertEqual(result["connections"],
                         [{"mode":"SIGNATURE","status":"PENDING_AUTH","count":1}])
        self.assertEqual(len(b.queries),4)
        for statement,params in b.queries:
            self.assertNotIn("INSERT ",statement.upper())
            self.assertNotIn("UPDATE ",statement.upper())
            self.assertNotIn("DELETE ",statement.upper())
            self.assertEqual(params,("workspace-id",))
        forbidden=("google_subject","workspaceId","accountNumber","balance",
                   "symbol","orders","privateKey")
        for word in forbidden:
            self.assertNotIn(word,result)

    def test_other_user_is_rejected_before_database_use(self):
        b=_Broker()
        with patch.object(diagnostics,"owner_only",side_effect=PilotError("NOT_AUTHORIZED")):
            with self.assertRaises(PilotError):
                diagnostics.view_diagnostics(object(),b,"222222222")
        self.assertEqual(b.queries,[])


if __name__=="__main__":
    unittest.main()
