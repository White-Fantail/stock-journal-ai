"""Production migrator safety policy (no real DB or credentials needed)."""
import hashlib
import tempfile
import unittest
from pathlib import Path

from services.saas_api.schema_admin import (
    APPROVED_AUTO_MIGRATIONS,
    PRODUCTION_RAILWAY_IDENTITY, SchemaRefused,
    manifest, validate_applied, validate_auto_deploy, validate_manual_apply,
)


class HostedSchemaPolicyTests(unittest.TestCase):
    def test_actual_migrations_have_contiguous_versions_and_hashes(self):
        planned = manifest()
        self.assertEqual([m[0] for m in planned],
                         ["001_identity.sql", "002_broker_links.sql", "003_trade_events.sql",
                          "004_csv_imports.sql", "005_remove_csv_imports.sql",
                          "006_journal_security.sql", "007_trade_runtime_login.sql",
                          "008_tiger_oauth.sql", "009_tiger_runtime_login.sql",
                          "010_broker_backfill_staging.sql",
                          "011_backfill_worker_fencing.sql", "012_backfill_page_resume.sql", "013_broker_dispatch_queue.sql",
                          "014_reconciliation_audit.sql", "015_reconciliation_lineage.sql",
                          "016_journal_plan_revisions.sql", "017_broker_ledger_publication.sql",
                          "018_journal_broker_fill_links.sql", "019_tiger_market_quotes.sql",
                           "020_journal_tiger_observation_links.sql",
                           "021_ai_request_quotas.sql",
                           "022_personal_sync_health.sql",
                           "023_investment_strategy_plan.sql"])
        self.assertTrue(all(len(m[1]) == 64 and m[2].strip() for m in planned))

    def test_strategy_plan_extension_is_nullable_append_only_and_forward_only(self):
        sql=next(body for name,_,body in manifest()
                 if name=="023_investment_strategy_plan.sql")
        self.assertIn("ALTER TABLE saas_journal_plan_revisions",sql)
        for field in ("strategy_type","investment_horizon","invalidation_condition",
                      "max_allocation_pct","review_cadence"):
            self.assertIn("ADD COLUMN "+field,sql)
        for forbidden in ("DROP TABLE","DROP COLUMN","UPDATE saas_","DELETE FROM",
                          "GRANT UPDATE","GRANT DELETE"):
            self.assertNotIn(forbidden,sql.upper() if forbidden.startswith("DROP") else sql)
        self.assertEqual(len([x for x in manifest() if x[0]=="023_investment_strategy_plan.sql"]),1)

    def test_tiger_sync_health_is_append_only_and_owner_scoped(self):
        source=next(sql for name,_,sql in manifest()
                    if name=="022_personal_sync_health.sql")
        self.assertIn("CREATE TABLE saas_tiger_personal_sync_health",source)
        self.assertIn("FORCE ROW LEVEL SECURITY",source)
        self.assertIn("GRANT SELECT,INSERT",source)
        self.assertNotIn("GRANT UPDATE",source)
        self.assertIn("run_id",source)

    def test_ai_quota_has_tenant_rls_and_no_prompt_storage(self):
        source=next(sql for name,_,sql in manifest()
                    if name=="021_ai_request_quotas.sql")
        self.assertIn("CREATE TABLE saas_ai_request_quotas",source)
        self.assertIn("FORCE ROW LEVEL SECURITY",source)
        self.assertIn("GRANT SELECT,INSERT,UPDATE",source)
        self.assertNotIn("DROP TABLE",source)
        self.assertNotIn("prompt",source.lower().replace("no prompt",""))

    def test_observation_journal_is_append_only_and_never_a_certified_fill(self):
        source=next(sql for name,_,sql in manifest()
                    if name=="020_journal_tiger_observation_links.sql")
        self.assertIn("CREATE TABLE saas_journal_tiger_observation_links",source)
        self.assertIn("FORCE ROW LEVEL SECURITY",source)
        self.assertIn("GRANT SELECT,INSERT",source)
        self.assertIn("OBSERVED_NOT_VERIFIED",source)
        self.assertIn("saas_journal_records",source)
        self.assertIn("saas_broker_accounts",source)
        self.assertNotIn("DROP TABLE",source)
        self.assertNotIn("GRANT UPDATE",source)

    def test_quoted_evidence_kind_extends_existing_rls_table_without_data_rewrite(self):
        source=next(sql for name,_,sql in manifest()
                    if name=="019_tiger_market_quotes.sql")
        self.assertIn("'QUOTES'",source)
        self.assertIn("saas_tiger_source_snapshots",source)
        self.assertNotIn("DROP TABLE",source)
        self.assertNotIn("UPDATE saas_",source)

    def test_saas_docker_packages_every_broker_module_import_root(self):
        from pathlib import Path
        docker=(Path(__file__).resolve().parents[1] /
                "services/saas_api/Dockerfile").read_text()
        for package in ("services/saas_api/","services/broker_connectors/",
                        "services/tiger_sync/"):
            self.assertIn("COPY "+package,docker,
                          msg="SaaS container missing a runtime dependency")

    def test_journal_plan_revisions_are_append_only_and_tenant_scoped(self):
        source=next(sql for name,_,sql in manifest()
                    if name=="016_journal_plan_revisions.sql")
        self.assertIn("CREATE TABLE saas_journal_plan_revisions",source)
        self.assertIn("FORCE ROW LEVEL SECURITY",source)
        self.assertIn("GRANT SELECT, INSERT",source)
        self.assertNotIn("GRANT UPDATE",source)
        self.assertNotIn("DROP TABLE",source)

    def test_lineage_migration_is_additive_and_enforces_source_account(self):
        source=next(sql for name,_,sql in manifest()
                    if name=="015_reconciliation_lineage.sql")
        self.assertIn("CREATE TABLE saas_reconciliation_source_links",source)
        self.assertIn("FOREIGN KEY (workspace_id,source_stage_id,account_id,source_key_hmac,evidence_sha256)",source)
        self.assertIn("FORCE ROW LEVEL SECURITY",source)
        self.assertNotIn("DROP TABLE",source)
        self.assertNotIn("GRANT UPDATE",source)

    def test_reconciliation_schema_enforces_immutable_tenant_staging(self):
        source = next(sql for name, _, sql in manifest()
                      if name == "014_reconciliation_audit.sql")
        for name in ("saas_reconciliation_versions","saas_reconciliation_issues",
                     "saas_verified_execution_stage","saas_projection_position_stage"):
            self.assertIn("CREATE TABLE "+name,source)
            self.assertIn("ALTER TABLE "+name+" FORCE ROW LEVEL SECURITY",source)
        self.assertIn("GRANT SELECT, INSERT",source)
        self.assertNotIn("GRANT UPDATE",source)
        self.assertNotIn("DROP TABLE",source)

    def test_broker_ledger_release_schema_is_append_only_and_account_bound(self):
        source=next(sql for name,_,sql in manifest()
                    if name=="017_broker_ledger_publication.sql")
        for table in ("saas_broker_ledger_publications","saas_broker_ledger_sources"):
            self.assertIn("CREATE TABLE "+table,source)
            self.assertIn("ALTER TABLE "+table+" FORCE ROW LEVEL SECURITY",source)
        self.assertIn("saas_verified_execution_stage",source)
        self.assertIn("saas_reconciliation_source_links",source)
        self.assertNotIn("DROP TABLE",source)
        self.assertNotIn("GRANT UPDATE",source)

    def test_broker_note_link_contract_is_append_only_and_tenant_scoped(self):
        source=next(sql for name,_,sql in manifest()
                    if name=="018_journal_broker_fill_links.sql")
        self.assertEqual(source.count("CREATE TABLE saas_journal_broker_fill_links"),1)
        self.assertIn("FORCE ROW LEVEL SECURITY",source)
        self.assertIn("saas_verified_execution_stage(workspace_id,version_id,source_key_hmac,symbol)",source)
        self.assertIn("REFERENCES saas_journal_records(workspace_id,id,author_user_id,ticker,entry_kind)",source)
        self.assertNotIn("GRANT UPDATE",source)
        self.assertNotIn("DROP TABLE",source)

    def test_paged_checkpoint_migration_is_additive_and_tenant_scoped(self):
        source = next(sql for name, _, sql in manifest()
                      if name == "012_backfill_page_resume.sql")
        self.assertIn("ADD COLUMN pages_staged", source)
        self.assertIn("pages_staged BETWEEN 0 AND 50", source)
        self.assertIn("GRANT UPDATE (pages_staged)", source)
        self.assertNotIn("DROP TABLE", source)

    def test_trade_migration_contains_exactly_one_valid_schema(self):
        # A source accident previously spliced repeated fragments into 003:
        # those fragments escaped a manifest checksum-only unit test but made
        # hosted migration impossible. Keep this guard alongside real PG CI.
        sql = next(source for name, _, source in manifest()
                   if name == "003_trade_events.sql")
        for fragment in (
            "CREATE TABLE saas_trade_events",
            "CREATE UNIQUE INDEX idx_saas_trade_void_once",
            "CREATE POLICY saas_trade_events_read",
            "CREATE POLICY saas_trade_events_insert",
            "GRANT SELECT, INSERT ON saas_trade_events",
        ):
            with self.subTest(fragment=fragment):
                self.assertEqual(sql.count(fragment), 1)
        self.assertIn("quantity IS NOT NULL AND quantity > 0", sql)
        self.assertIn("price IS NOT NULL AND price > 0", sql)
        self.assertIn("executed_at_source IS NOT NULL", sql)
        self.assertIn("ALTER TABLE saas_trade_events FORCE ROW LEVEL SECURITY", sql)
        self.assertIn("CREATE TRIGGER trg_saas_assert_trade_void_target", sql)
        self.assertIn("RETURNS trigger LANGUAGE plpgsql", sql)
        self.assertNotIn("GRANT UPDATE", sql)
        self.assertNotIn("GRANT DELETE", sql)

    def test_railway_predeploy_gate_is_main_only_and_requires_backup_policy(self):
        planned = manifest()
        env = {
            **PRODUCTION_RAILWAY_IDENTITY,
            "SAAS_AUTO_MIGRATE": "1",
            "SAAS_MIGRATION_BACKUP_VERIFIED": "1",
            "SAAS_TRADE_RUNTIME_PASSWORD": "a" * 64,
        }
        # Main applies the immutable 004 history and compensating 005 removal.
        self.assertEqual({name for name, _, _ in planned}, APPROVED_AUTO_MIGRATIONS)
        self.assertEqual(validate_auto_deploy(env, planned), planned)
        for update in (
            {"SAAS_AUTO_MIGRATE": "0"},
            {"SAAS_MIGRATION_BACKUP_VERIFIED": "0"},
            {"RAILWAY_GIT_BRANCH": "dev"},
            {"RAILWAY_SERVICE_ID": "another-service"},
            {"RAILWAY_PROJECT_ID": "another-project"},
            {"RAILWAY_ENVIRONMENT_NAME": "staging"},
            {"RAILWAY_GIT_REPO_OWNER": "untrusted"},
            {"SAAS_TEST_DB_ACK": "YES_DISPOSABLE_SAAS_DB"},
        ):
            with self.subTest(update=update):
                with self.assertRaises(SchemaRefused):
                    validate_auto_deploy({**env, **update}, planned)
        with self.assertRaises(SchemaRefused):
            validate_auto_deploy(env, planned + [("006_unreviewed.sql", "f" * 64, "SELECT 1")])
        with self.assertRaises(SchemaRefused):
            validate_auto_deploy(env, planned[:-1])

    def test_manual_schema_apply_uses_same_reviewed_manifest(self):
        pending = manifest()
        validate_manual_apply(pending)
        with self.assertRaises(SchemaRefused):
            validate_manual_apply(pending + [("006_unreviewed.sql", "f" * 64, "SELECT 1")])

    def test_csv_removal_is_forward_only_and_guards_nonempty_tables(self):
        source = next(s for name, _, s in manifest() if name == "005_remove_csv_imports.sql")
        self.assertIn("LOCK TABLE", source)
        self.assertIn("ACCESS EXCLUSIVE", source)
        self.assertIn("SELECT EXISTS", source)
        self.assertIn("RAISE EXCEPTION", source)
        self.assertIn("DROP TABLE public.saas_csv_import_rows", source)
        self.assertIn("DROP TABLE public.saas_csv_import_batches", source)
        self.assertLess(source.index("DROP TABLE public.saas_csv_import_rows"),
                        source.index("DROP TABLE public.saas_csv_import_batches"))

    def test_empty_database_bootstraps_and_applied_versions_are_idempotent(self):
        planned = manifest()
        self.assertEqual(validate_applied(planned, {}, set()), planned)
        self.assertEqual(validate_applied(
            planned, {name: checksum for name, checksum, _ in planned}, set()
        ), [])

    def test_do_not_adopt_legacy_or_partial_untracked_schema(self):
        for tables in ({"trades"}, {"saas_users"}, {"saas_schema_versions"}):
            with self.assertRaises(SchemaRefused):
                validate_applied(manifest(), {}, tables)

    def test_reject_changed_or_unknown_history_and_nonprefix(self):
        planned = manifest()
        first, second, third, fourth, fifth, sixth, seventh = planned[:7]
        bad_cases = [
            {first[0]: "0" * 64},
            {second[0]: second[1]},
            {first[0]: first[1], second[0]: second[1], third[0]: "0" * 64},
            {first[0]: first[1], second[0]: second[1], third[0]: third[1], fourth[0]: "0" * 64},
            {first[0]: first[1], second[0]: second[1], third[0]: third[1],
             fourth[0]: fourth[1], fifth[0]: "0" * 64},
            {first[0]: first[1], second[0]:second[1], third[0]:third[1],
             fourth[0]:fourth[1], fifth[0]:fifth[1], sixth[0]:"0"*64},
            {first[0]:first[1],second[0]:second[1],third[0]:third[1],
             fourth[0]:fourth[1],fifth[0]:fifth[1],sixth[0]:sixth[1],
             seventh[0]:"0"*64},
            {"999_unknown.sql": "f" * 64},
        ]
        for applied in bad_cases:
            with self.subTest(applied=applied):
                with self.assertRaises(SchemaRefused):
                    validate_applied(planned, applied, set())

    def test_missing_versions_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "001_first.sql").write_text("SELECT 1")
            (root / "003_third.sql").write_text("SELECT 3")
            with self.assertRaises(SchemaRefused):
                manifest(root)

if __name__ == "__main__":
    unittest.main()
