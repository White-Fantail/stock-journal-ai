-- P5 AI: workspace-only request quota, no prompt, notes, model output or account data.
-- Forward-only. Each client action must separately opt in before a request claim.
CREATE TABLE saas_ai_request_quotas (
  workspace_id uuid NOT NULL REFERENCES saas_workspaces(id) ON DELETE CASCADE,
  period_type text NOT NULL CHECK (period_type IN ('DAY','MONTH')),
  period_start date NOT NULL,
  request_count integer NOT NULL CHECK (request_count BETWEEN 1 AND 60),
  last_requested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,period_type,period_start)
);
ALTER TABLE saas_ai_request_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_ai_request_quotas FORCE ROW LEVEL SECURITY;
CREATE POLICY saas_ai_quota_select ON saas_ai_request_quotas FOR SELECT
  USING (workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
CREATE POLICY saas_ai_quota_insert ON saas_ai_request_quotas FOR INSERT
  WITH CHECK (workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
CREATE POLICY saas_ai_quota_update ON saas_ai_request_quotas FOR UPDATE
  USING (workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid)
  WITH CHECK (workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON saas_ai_request_quotas TO saas_trade_runtime;
REVOKE DELETE,TRUNCATE,REFERENCES,TRIGGER
  ON saas_ai_request_quotas FROM saas_trade_runtime;
