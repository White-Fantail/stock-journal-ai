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
                          "011_backfill_worker_fencing.sql"])
        self.assertTrue(all(len(m[1]) == 64 and m[2].strip() for m in planned))

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
