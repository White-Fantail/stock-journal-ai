-- S2 staged schema: tenant-scoped broker connections, accounts and sync metadata.
-- No credentials, account numbers, brokerage payloads or customer records seeded.
-- Test-only migration runner; never applied to an operating SaaS DB yet.
CREATE TABLE saas_broker_connections (
  workspace_id uuid NOT NULL REFERENCES saas_workspaces(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider_code text NOT NULL CHECK (provider_code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  auth_mode text NOT NULL CHECK (auth_mode IN ('OAUTH2','SIGNATURE','OTHER')),
  status text NOT NULL DEFAULT 'NOT_CONNECTED'
    CHECK (status IN ('NOT_CONNECTED','PENDING_AUTH','CONNECTED','REAUTH_REQUIRED','DISCONNECTED','ERROR')),
  -- UUID is a locator for a separately encrypted secret-store record. No raw
  -- API keys, tokens or private keys are ever columns in this schema.
  credential_handle uuid,
  granted_scopes text[] NOT NULL DEFAULT '{}',
  authorization_expires_at timestamptz,
  last_success_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,id),
  CONSTRAINT broker_connected_requires_handle CHECK (
    status <> 'CONNECTED' OR credential_handle IS NOT NULL
  )
);

CREATE TABLE saas_broker_accounts (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  -- This MUST be a keyed HMAC of provider + remote account identifier,
  -- not unhashed/plain account number or unsalted SHA-256.
  external_account_fingerprint char(64) NOT NULL
    CHECK (external_account_fingerprint ~ '^[0-9a-f]{64}$'),
  alias text NOT NULL CHECK (length(alias) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,id),
  FOREIGN KEY (workspace_id,connection_id)
    REFERENCES saas_broker_connections(workspace_id,id),
  UNIQUE (workspace_id,connection_id,external_account_fingerprint)
);

CREATE TABLE saas_broker_sync_runs (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'PENDING'
    CHECK (state IN ('PENDING','RUNNING','COMPLETE','PARTIAL','FAILED')),
  start_utc timestamptz NOT NULL,
  end_utc timestamptz NOT NULL,
  issue_count integer NOT NULL DEFAULT 0 CHECK (issue_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (workspace_id,id),
  FOREIGN KEY (workspace_id,account_id)
    REFERENCES saas_broker_accounts(workspace_id,id),
  CHECK (end_utc > start_utc AND end_utc <= start_utc + interval '89 days')
);

CREATE INDEX idx_broker_accounts_connection
  ON saas_broker_accounts (workspace_id,connection_id);
CREATE INDEX idx_broker_sync_account
  ON saas_broker_sync_runs (workspace_id,account_id,created_at DESC);

-- Per-transaction SET LOCAL saas.workspace_id, never session-sticky tenant
-- selection. All runtime roles MUST be non-superuser and NOBYPASSRLS.
ALTER TABLE saas_broker_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_broker_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY broker_connections_tenant ON saas_broker_connections
  USING (workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid);

ALTER TABLE saas_broker_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_broker_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY broker_accounts_tenant ON saas_broker_accounts
  USING (workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid);

ALTER TABLE saas_broker_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_broker_sync_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY broker_sync_tenant ON saas_broker_sync_runs
  USING (workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
