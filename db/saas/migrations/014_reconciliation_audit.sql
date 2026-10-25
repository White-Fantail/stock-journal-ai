-- P4 forward-only, append-only, private reconciliation audit and staged projections.
-- No broker history is promoted into a customer-facing portfolio by this SQL.
CREATE TABLE saas_reconciliation_versions (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  version_num integer NOT NULL CHECK (version_num BETWEEN 1 AND 2147483647),
  evidence_hmac char(64) NOT NULL CHECK (evidence_hmac ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('BLOCKED','STAGED')),
  algorithm text NOT NULL DEFAULT 'FIFO_V1' CHECK (algorithm='FIFO_V1'),
  checked_fills integer NOT NULL CHECK (checked_fills BETWEEN 0 AND 5000),
  duplicate_replays integer NOT NULL CHECK (duplicate_replays BETWEEN 0 AND 5000),
  as_of_utc timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,id),
  UNIQUE (workspace_id,id,account_id),
  UNIQUE (workspace_id,account_id,version_num),
  UNIQUE (workspace_id,account_id,evidence_hmac),
  FOREIGN KEY (workspace_id,account_id)
    REFERENCES saas_broker_accounts(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX idx_reconciliation_recent
  ON saas_reconciliation_versions(workspace_id,account_id,version_num DESC);
CREATE TABLE saas_reconciliation_issues (
  workspace_id uuid NOT NULL,
  version_id uuid NOT NULL,
  account_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  PRIMARY KEY(workspace_id,version_id,code),
  FOREIGN KEY (workspace_id,version_id,account_id)
    REFERENCES saas_reconciliation_versions(workspace_id,id,account_id) ON DELETE CASCADE
);
CREATE TABLE saas_verified_execution_stage (
  workspace_id uuid NOT NULL,
  version_id uuid NOT NULL,
  account_id uuid NOT NULL,
  source_key_hmac char(64) NOT NULL CHECK (source_key_hmac ~ '^[0-9a-f]{64}$'),
  symbol text NOT NULL CHECK (symbol ~ '^[A-Z0-9.:-]{1,32}$'),
  side text NOT NULL CHECK (side IN ('BUY','SELL')),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  quantity numeric(36,12) NOT NULL CHECK (quantity>0),
  price numeric(36,12) NOT NULL CHECK (price>0),
  fee numeric(36,12) NOT NULL CHECK (fee>=0),
  executed_at_utc timestamptz NOT NULL,
  PRIMARY KEY (workspace_id,version_id,source_key_hmac),
  FOREIGN KEY (workspace_id,version_id,account_id)
    REFERENCES saas_reconciliation_versions(workspace_id,id,account_id) ON DELETE CASCADE
);
CREATE TABLE saas_projection_position_stage (
  workspace_id uuid NOT NULL,
  version_id uuid NOT NULL,
  account_id uuid NOT NULL,
  symbol text NOT NULL CHECK (symbol ~ '^[A-Z0-9.:-]{1,32}$'),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  quantity numeric(36,12) NOT NULL CHECK (quantity>=0),
  cost_basis numeric(36,12) NOT NULL CHECK (cost_basis>=0),
  realized_pnl numeric(36,12) NOT NULL,
  PRIMARY KEY(workspace_id,version_id,symbol,currency),
  FOREIGN KEY (workspace_id,version_id,account_id)
    REFERENCES saas_reconciliation_versions(workspace_id,id,account_id) ON DELETE CASCADE
);
-- Runtime sees tenant private data; it may insert immutable versions only.
-- Never permit UPDATE/DELETE (no silent resolution or revision rewrite).
GRANT SELECT, INSERT ON saas_reconciliation_versions, saas_reconciliation_issues,
  saas_verified_execution_stage, saas_projection_position_stage
  TO saas_broker_runtime;
ALTER TABLE saas_reconciliation_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_reconciliation_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_version_tenant ON saas_reconciliation_versions
  USING (workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid)
  WITH CHECK (workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
ALTER TABLE saas_reconciliation_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_reconciliation_issues FORCE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_issue_tenant ON saas_reconciliation_issues
  USING (workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid)
  WITH CHECK (workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
ALTER TABLE saas_verified_execution_stage ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_verified_execution_stage FORCE ROW LEVEL SECURITY;
CREATE POLICY verified_execution_stage_tenant ON saas_verified_execution_stage
  USING (workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid)
  WITH CHECK (workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
ALTER TABLE saas_projection_position_stage ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_projection_position_stage FORCE ROW LEVEL SECURITY;
CREATE POLICY projection_position_stage_tenant ON saas_projection_position_stage
  USING (workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid)
  WITH CHECK (workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
-- A compromised broker DB login cannot alter existing history using TRUNCATE.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON saas_reconciliation_versions,
 saas_reconciliation_issues, saas_verified_execution_stage,
 saas_projection_position_stage FROM saas_broker_runtime;
