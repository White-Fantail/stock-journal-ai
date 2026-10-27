-- 024: Explicit user-authored adherence check-in to an immutable plan revision.
-- No brokerage execution, price trigger, trading request, or inferred compliance.
-- Atomic companion REVIEW note is created by the dedicated scoped service.
CREATE TABLE saas_journal_plan_checkins (
  workspace_id uuid NOT NULL REFERENCES saas_workspaces(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  author_user_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  ticker text NOT NULL CHECK (ticker ~ '^[A-Z0-9.:-]{1,32}$'),
  plan_revision_id uuid NOT NULL,
  journal_id uuid NOT NULL,
  self_assessment text NOT NULL CHECK (self_assessment IN
    ('FOLLOWED','PARTIAL','DEVIATED','UNCERTAIN')),
  next_action text NOT NULL CHECK (
    char_length(next_action) BETWEEN 1 AND 1500 AND length(btrim(next_action))>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,id),
  UNIQUE (workspace_id,idempotency_key),
  UNIQUE (workspace_id,journal_id),
  FOREIGN KEY (workspace_id,author_user_id)
    REFERENCES saas_workspace_memberships(workspace_id,user_id),
  FOREIGN KEY (workspace_id,plan_revision_id)
    REFERENCES saas_journal_plan_revisions(workspace_id,id),
  FOREIGN KEY (workspace_id,journal_id)
    REFERENCES saas_journal_records(workspace_id,id)
);
CREATE INDEX idx_saas_plan_checkins_month
  ON saas_journal_plan_checkins(workspace_id,created_at DESC,id DESC);
CREATE INDEX idx_saas_plan_checkins_symbol
  ON saas_journal_plan_checkins(workspace_id,ticker,created_at DESC);
ALTER TABLE saas_journal_plan_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_journal_plan_checkins FORCE ROW LEVEL SECURITY;
CREATE POLICY saas_plan_checkin_read ON saas_journal_plan_checkins FOR SELECT
  USING (workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
CREATE POLICY saas_plan_checkin_insert ON saas_journal_plan_checkins FOR INSERT
  WITH CHECK (
    workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid
    AND author_user_id = NULLIF(current_setting('saas.user_id',true),'')::uuid
  );
GRANT SELECT,INSERT ON saas_journal_plan_checkins TO saas_trade_runtime;
-- No UPDATE/DELETE/forced position state, and no historical revision rewrite.
