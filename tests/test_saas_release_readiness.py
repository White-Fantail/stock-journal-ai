"""Release guard: every tenant table must have a reviewed removal route.

Pure source-contract test. It cannot prove production backups, live OAuth,
Railway pre-deploy migration status, real Tiger entitlements or rendered browser
UX. It DOES prevent new tenant tables from silently outgrowing account deletion
and ensures every authored self assessment is included in a complete export.
"""
from pathlib import Path
import re
import unittest

from services.saas_api.schema_admin import manifest, APPROVED_AUTO_MIGRATIONS

ROOT=Path(__file__).resolve().parents[1]
NON_TENANT={
 "saas_internal_request_nonces", # global one-time HMAC replay metadata
 "saas_internal_rate_limits",     # gateway throttle buckets, TTL-bound
}
RETIRED={"saas_csv_import_batches","saas_csv_import_rows"}
CASCADE={
 "saas_journal_broker_fill_links", # composite FK ON DELETE CASCADE journal
 "saas_journal_tiger_observation_links", # composite FK cascade journal
}

class ReleaseReadinessContractTests(unittest.TestCase):
 def test_all_created_tables_have_reviewed_account_deletion_coverage(self):
  code=(ROOT/"services/saas_api/account.py").read_text()
  expected=set()
  for name,_,source in manifest():
   expected.update(re.findall(
    r"CREATE TABLE(?: IF NOT EXISTS)?\s+(saas_[a-z0-9_]+)",source,re.I))
  deletion=set(re.findall(r'"(saas_[a-z0-9_]+)"',code,re.I))
  self.assertIn("DELETE FROM saas_users WHERE id=%s",code)
  deletion.add("saas_users")
  # Require explicit justification for every exception, or the safety gate fails.
  self.assertEqual(expected-deletion,NON_TENANT|RETIRED|CASCADE)
  for table in ("saas_journal_plan_checkins","saas_review_action_followups","saas_investor_principle_revisions","saas_tiger_personal_sync_health",
                "saas_ai_request_quotas","saas_reconciliation_versions"):
   self.assertIn(table,deletion)
  self.assertIn('if confirmation != "DELETE_MY_ACCOUNT":',code)
  self.assertIn("WHERE id=%s AND owner_user_id=%s FOR UPDATE",code)
  self.assertIn("credential_handle IS NOT NULL",code)
  self.assertIn("with identity_conn.transaction()",code)
  self.assertNotIn("TRUNCATE",code)

 def test_sensitive_self_assessments_are_exported_or_request_fails(self):
  backend=(ROOT/"services/saas_api/journal.py").read_text()
  frontend=(ROOT/"apps/web/lib/saas-trades-api.ts").read_text()
  route=(ROOT/"apps/web/app/api/private/journal/export/route.ts").read_text()
  self.assertIn("FROM saas_journal_plan_checkins",backend)
  self.assertIn('"planSelfReviews":',backend)
  self.assertIn("len(checkins) > _LIMIT",backend)
  self.assertIn("len(action_followups) > _LIMIT",backend)
  self.assertIn("Array.isArray(result.planSelfReviews)",frontend)
  self.assertIn("FROM saas_review_action_followups",backend)
  self.assertIn('"actionFollowups":',backend)
  self.assertIn("Array.isArray(result.actionFollowups)",frontend)
  self.assertIn("FROM saas_investor_principle_revisions",backend)
  self.assertIn('"investorPrinciples":',backend)
  self.assertIn("Array.isArray(result.investorPrinciples)",frontend)
  self.assertIn("FROM saas_risk_factor_revisions",backend)
  self.assertIn('"riskFactors":',backend)
  self.assertIn("Array.isArray(result.riskFactors)",frontend)
  self.assertIn("currentWorkspace()",route)
  self.assertIn("Cache-Control",route)
  self.assertIn("no-store",route)

 def test_main_release_is_guarded_by_forward_migrations_not_dev_auto_deploy(self):
  from services.saas_api.schema_admin import PRODUCTION_RAILWAY_IDENTITY
  self.assertEqual(PRODUCTION_RAILWAY_IDENTITY["RAILWAY_GIT_BRANCH"],"main")
  names=[name for name,_,_ in manifest()]
  self.assertEqual(set(names),APPROVED_AUTO_MIGRATIONS)
  self.assertEqual(names[-1],"028_plan_risk_decision_note.sql")
  workflow=(ROOT/".github/workflows/saas.yml").read_text()
  self.assertIn("branches: [dev, main]",workflow)
  self.assertIn("python scripts/verify_saas_http_isolation.py",workflow)
  self.assertIn("python scripts/verify_saas_plan_checkins.py",workflow)
  self.assertIn("python -m services.saas_api.schema_admin --",workflow)

if __name__=="__main__":
 unittest.main()
