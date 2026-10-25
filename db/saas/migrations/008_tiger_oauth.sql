-- P3 hosted partner OAuth: no raw tokens or account numbers in plaintext.
-- Forward-only, no existing customer rows rewritten.
CREATE TABLE saas_tiger_oauth_attempts (
  workspace_id uuid NOT NULL,
  state_sha256 char(64) NOT NULL CHECK (state_sha256 ~ '^[0-9a-f]{64}$'),
  connection_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  PRIMARY KEY (workspace_id,state_sha256),
  FOREIGN KEY (workspace_id,connection_id) REFERENCES saas_broker_connections(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX idx_tiger_auth_expiry ON saas_tiger_oauth_attempts (expires_at);
CREATE TABLE saas_tiger_grants (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) > 28),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,id),
  UNIQUE (workspace_id,connection_id),
  FOREIGN KEY (workspace_id,connection_id) REFERENCES saas_broker_connections(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE saas_tiger_account_secrets (
  workspace_id uuid NOT NULL,
  account_id uuid NOT NULL,
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) > 28),
  PRIMARY KEY (workspace_id,account_id),
  FOREIGN KEY (workspace_id,account_id) REFERENCES saas_broker_accounts(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE saas_tiger_source_snapshots (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('ASSETS','POSITIONS','TRANSACTIONS')),
  evidence_sha256 char(64) NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  encrypted_payload bytea NOT NULL CHECK (octet_length(encrypted_payload) > 28),
  completeness text NOT NULL CHECK (completeness IN ('SNAPSHOT_ONLY','PARTIAL')),
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,id),
  FOREIGN KEY (workspace_id,account_id) REFERENCES saas_broker_accounts(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX idx_tiger_snapshot_lookup ON saas_tiger_source_snapshots
  (workspace_id,account_id,observed_at DESC);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='saas_broker_runtime') THEN
    CREATE ROLE saas_broker_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO saas_broker_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON saas_broker_connections, saas_broker_accounts,
  saas_broker_sync_runs, saas_tiger_oauth_attempts, saas_tiger_grants,
  saas_tiger_account_secrets TO saas_broker_runtime;
GRANT SELECT, INSERT ON saas_tiger_source_snapshots TO saas_broker_runtime;
-- Runtime login must be a separately provisioned, non-BYPASSRLS member of saas_broker_runtime.
-- Every request uses SET LOCAL saas.workspace_id; never reuse a pool session tenant.
ALTER TABLE saas_tiger_oauth_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_tiger_oauth_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY tiger_oauth_tenant ON saas_tiger_oauth_attempts
  USING (workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
ALTER TABLE saas_tiger_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_tiger_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY tiger_grant_tenant ON saas_tiger_grants
  USING (workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
ALTER TABLE saas_tiger_account_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_tiger_account_secrets FORCE ROW LEVEL SECURITY;
CREATE POLICY tiger_account_secret_tenant ON saas_tiger_account_secrets
  USING (workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
ALTER TABLE saas_tiger_source_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_tiger_source_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY tiger_snapshot_tenant ON saas_tiger_source_snapshots FOR SELECT
  USING (workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
CREATE POLICY tiger_snapshot_insert ON saas_tiger_source_snapshots FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
