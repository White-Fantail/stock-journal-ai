-- Read-only personal Tiger cron health evidence; no balances, account number,
-- credentials, provider responses or user trade fields.
CREATE TABLE saas_tiger_personal_sync_health (
  workspace_id uuid NOT NULL,
  account_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  assets_status text NOT NULL CHECK (assets_status IN ('OK','FAILED')),
  orders_status text NOT NULL CHECK (orders_status IN ('OK','PARTIAL','FAILED')),
  fills_status text NOT NULL CHECK (fills_status IN ('OK','PARTIAL','UNAVAILABLE')),
  reported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,id),
  UNIQUE(workspace_id,account_id,run_id),
  FOREIGN KEY (workspace_id,account_id)
    REFERENCES saas_broker_accounts(workspace_id,id)
);
CREATE INDEX idx_personal_sync_health_account
  ON saas_tiger_personal_sync_health (workspace_id,account_id,reported_at DESC);
ALTER TABLE saas_tiger_personal_sync_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_tiger_personal_sync_health FORCE ROW LEVEL SECURITY;
CREATE POLICY personal_sync_health_read ON saas_tiger_personal_sync_health FOR SELECT
  USING (workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
CREATE POLICY personal_sync_health_insert ON saas_tiger_personal_sync_health FOR INSERT
  WITH CHECK (workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
GRANT SELECT,INSERT ON saas_tiger_personal_sync_health TO saas_broker_runtime;
REVOKE UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER
  ON saas_tiger_personal_sync_health FROM saas_broker_runtime;
