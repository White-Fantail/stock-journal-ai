-- 026: user-authored portfolio-wide intentions; append-only, no orders.
CREATE TABLE saas_investor_principle_revisions (
  workspace_id uuid NOT NULL REFERENCES saas_workspaces(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  author_user_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  objective text CHECK (objective IS NULL OR objective IN ('GROWTH','INCOME','PRESERVATION','LEARNING','OTHER')),
  horizon text CHECK (horizon IS NULL OR horizon IN ('UNDER_3_YEARS','THREE_TO_TEN_YEARS','OVER_TEN_YEARS','UNDECIDED')),
  base_currency text CHECK (base_currency IS NULL OR base_currency ~ '^[A-Z]{3}$'),
  max_single_pct numeric(5,2) CHECK (max_single_pct IS NULL OR (max_single_pct>0 AND max_single_pct<=100)),
  risk_limit_pct numeric(5,2) CHECK (risk_limit_pct IS NULL OR (risk_limit_pct>0 AND risk_limit_pct<=100)),
  review_cadence text CHECK (review_cadence IS NULL OR review_cadence IN ('MONTHLY','QUARTERLY','SEMIANNUAL','ANNUAL')),
  note text CHECK (note IS NULL OR (char_length(note) BETWEEN 1 AND 1500 AND length(btrim(note))>0)),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,id),
  UNIQUE (workspace_id,idempotency_key),
  FOREIGN KEY (workspace_id,author_user_id) REFERENCES saas_workspace_memberships(workspace_id,user_id)
);
CREATE INDEX idx_saas_investor_principles_latest
 ON saas_investor_principle_revisions(workspace_id,created_at DESC,id DESC);
ALTER TABLE saas_investor_principle_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_investor_principle_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY saas_investor_principles_read ON saas_investor_principle_revisions FOR SELECT
 USING(workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
CREATE POLICY saas_investor_principles_insert ON saas_investor_principle_revisions FOR INSERT
 WITH CHECK(workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid
  AND author_user_id=NULLIF(current_setting('saas.user_id',true),'')::uuid);
GRANT SELECT,INSERT ON saas_investor_principle_revisions TO saas_trade_runtime;
