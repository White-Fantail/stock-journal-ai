-- 025: immutable user-labeled stock risk-factor revisions, not correlations.
-- The user chooses 0..3 factors; empty array explicitly unclassifies.
CREATE TABLE saas_risk_factor_revisions(
 workspace_id uuid NOT NULL REFERENCES saas_workspaces(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 author_user_id uuid NOT NULL,
 idempotency_key uuid NOT NULL,
 request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 ticker text NOT NULL CHECK(ticker ~ '^[A-Z0-9.:-]{1,32}$'),
 factors text[] NOT NULL CHECK (
    cardinality(factors)<=3 AND factors <@ ARRAY[
      'AI_INFRA','HIGH_GROWTH','US_TECH','CONSUMER_CYCLICAL',
      'SPACE_DEFENSE','INTEREST_RATE','CHINA','OTHER'
    ]::text[]),
 rationale text NOT NULL CHECK(length(btrim(rationale)) BETWEEN 1 AND 1500),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id),
 UNIQUE(workspace_id,idempotency_key),
 FOREIGN KEY(workspace_id,author_user_id)
   REFERENCES saas_workspace_memberships(workspace_id,user_id)
);
CREATE INDEX idx_saas_risk_factor_latest
 ON saas_risk_factor_revisions(workspace_id,ticker,created_at DESC,id DESC);
ALTER TABLE saas_risk_factor_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_risk_factor_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY saas_risk_factor_select ON saas_risk_factor_revisions FOR SELECT
 USING(workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
CREATE POLICY saas_risk_factor_insert ON saas_risk_factor_revisions FOR INSERT
 WITH CHECK(workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid
       AND author_user_id=NULLIF(current_setting('saas.user_id',true),'')::uuid);
GRANT SELECT,INSERT ON saas_risk_factor_revisions TO saas_trade_runtime;
-- No role grants UPDATE/DELETE. No stock or factor is auto classified.
