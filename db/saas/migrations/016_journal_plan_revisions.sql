-- P2 journal UX: immutable user-authored target/stop plan revisions.
-- These annotations are NOT market/broker orders and do not assert holdings.
CREATE TABLE saas_journal_plan_revisions (
  workspace_id uuid NOT NULL REFERENCES saas_workspaces(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  author_user_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  ticker text NOT NULL CHECK (ticker ~ '^[A-Z0-9.:-]{1,32}$'),
  target_price numeric(36,12),
  stop_price numeric(36,12),
  price_currency char(3),
  rationale text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,id),
  UNIQUE(workspace_id,idempotency_key),
  FOREIGN KEY(workspace_id,author_user_id)
    REFERENCES saas_workspace_memberships(workspace_id,user_id),
  CHECK (target_price IS NULL OR target_price>0),
  CHECK (stop_price IS NULL OR stop_price>0),
  CHECK (price_currency IS NULL OR price_currency ~ '^[A-Z]{3}$'),
  CHECK ((target_price IS NULL AND stop_price IS NULL AND price_currency IS NULL)
         OR ((target_price IS NOT NULL OR stop_price IS NOT NULL)
             AND price_currency IS NOT NULL)),
  CHECK (length(rationale) BETWEEN 1 AND 3000 AND length(btrim(rationale))>0)
);
CREATE INDEX idx_journal_plan_recent
  ON saas_journal_plan_revisions(workspace_id,created_at DESC,id DESC);
CREATE INDEX idx_journal_plan_ticker
  ON saas_journal_plan_revisions(workspace_id,ticker,created_at DESC,id DESC);
ALTER TABLE saas_journal_plan_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_journal_plan_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY journal_plan_read ON saas_journal_plan_revisions FOR SELECT
  USING (workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
CREATE POLICY journal_plan_insert ON saas_journal_plan_revisions FOR INSERT
  WITH CHECK (workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid
    AND author_user_id=NULLIF(current_setting('saas.user_id',true),'')::uuid);
GRANT SELECT, INSERT ON saas_journal_plan_revisions TO saas_trade_runtime;
