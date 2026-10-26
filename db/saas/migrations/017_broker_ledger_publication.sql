-- P4: immutable *private* broker-ledger publication manifest, never manual trades.
-- No source is public without separate independent signer and application gate.
-- 014–016 are immutable; no destructive migration or trading permission.
CREATE TABLE saas_broker_ledger_publications (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  review_version_id uuid NOT NULL,
  review_version_num integer NOT NULL CHECK (review_version_num > 0),
  publication_digest char(64) NOT NULL CHECK (publication_digest ~ '^[0-9a-f]{64}$'),
  as_of_utc timestamptz NOT NULL,
  source_count integer NOT NULL CHECK (source_count BETWEEN 0 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,id),
  UNIQUE(workspace_id,id,account_id,review_version_id),
  UNIQUE(workspace_id,account_id,review_version_id),
  FOREIGN KEY(workspace_id,review_version_id,account_id)
    REFERENCES saas_reconciliation_versions(workspace_id,id,account_id) ON DELETE CASCADE
);
CREATE INDEX idx_broker_ledger_latest ON saas_broker_ledger_publications
 (workspace_id,account_id,review_version_num DESC);

-- The release points to immutable staged facts, not user-entered trades.
-- Composite FKs bind each original encrypted provider evidence version and
-- prevent cross-account/cross-version association at the SQL boundary.
ALTER TABLE saas_reconciliation_source_links
  ADD CONSTRAINT uq_reconciliation_link_release_identity
  UNIQUE(workspace_id,version_id,account_id,source_key_hmac,source_stage_id,evidence_sha256);

CREATE TABLE saas_broker_ledger_sources (
  workspace_id uuid NOT NULL,
  publication_id uuid NOT NULL,
  account_id uuid NOT NULL,
  review_version_id uuid NOT NULL,
  source_key_hmac char(64) NOT NULL CHECK (source_key_hmac ~ '^[0-9a-f]{64}$'),
  source_stage_id uuid NOT NULL,
  evidence_sha256 char(64) NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY(workspace_id,publication_id,source_key_hmac),
  FOREIGN KEY(workspace_id,publication_id,account_id,review_version_id)
    REFERENCES saas_broker_ledger_publications(workspace_id,id,account_id,review_version_id)
    ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,review_version_id,account_id,source_key_hmac,
              source_stage_id,evidence_sha256)
    REFERENCES saas_reconciliation_source_links(workspace_id,version_id,account_id,
              source_key_hmac,source_stage_id,evidence_sha256),
  FOREIGN KEY(workspace_id,review_version_id,source_key_hmac)
    REFERENCES saas_verified_execution_stage(workspace_id,version_id,source_key_hmac)
);
-- Release inserts are NOT permitted for the Tiger collection/staging role.
-- Publisher is a distinct passwordless-by-default non-BYPASSRLS login; an
-- operator must independently provision its password only after approvals.
DO $publish_roles$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='saas_publication_runtime') THEN
   CREATE ROLE saas_publication_runtime NOLOGIN;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='saas_publication_app') THEN
   CREATE ROLE saas_publication_app LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
       NOREPLICATION NOBYPASSRLS PASSWORD NULL;
 END IF;
END $publish_roles$;
GRANT saas_publication_runtime TO saas_publication_app;
GRANT SELECT ON saas_broker_ledger_publications,saas_broker_ledger_sources
 TO saas_broker_runtime;
GRANT SELECT,INSERT ON saas_broker_ledger_publications,saas_broker_ledger_sources
 TO saas_publication_runtime;
-- Only narrow reads needed to verify origin, membership-scoped entitlements and
-- the normalized staging review. No INSERT/UPDATE on Tiger source/staging.
GRANT SELECT ON saas_broker_accounts,saas_broker_connections,
  saas_tiger_grants,saas_tiger_account_secrets,
  saas_reconciliation_versions,saas_verified_execution_stage,
  saas_projection_position_stage,saas_reconciliation_source_links,
  saas_broker_source_stage TO saas_publication_runtime;
ALTER TABLE saas_broker_ledger_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_broker_ledger_publications FORCE ROW LEVEL SECURITY;
CREATE POLICY broker_ledger_publication_tenant ON saas_broker_ledger_publications
  USING (workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid)
  WITH CHECK (workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
ALTER TABLE saas_broker_ledger_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_broker_ledger_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY broker_ledger_source_tenant ON saas_broker_ledger_sources
  USING (workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid)
  WITH CHECK (workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
REVOKE UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER
  ON saas_broker_ledger_publications,saas_broker_ledger_sources
  FROM saas_publication_runtime,saas_broker_runtime;
