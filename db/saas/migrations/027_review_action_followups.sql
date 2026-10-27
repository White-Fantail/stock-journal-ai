-- 027: explicit user reports about their earlier self-authored next action.
-- Immutable revisions. No inferred completion, broker trading, prices or notifications.
CREATE TABLE saas_review_action_followups (
 workspace_id uuid NOT NULL REFERENCES saas_workspaces(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 author_user_id uuid NOT NULL,
 idempotency_key uuid NOT NULL,
 request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 checkin_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('DONE','NOT_DONE','NOT_APPLICABLE','UNCERTAIN')),
 note text CHECK(note IS NULL OR (char_length(note) BETWEEN 1 AND 1000 AND length(btrim(note))>0)),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id),
 UNIQUE(workspace_id,idempotency_key),
 FOREIGN KEY(workspace_id,author_user_id) REFERENCES saas_workspace_memberships(workspace_id,user_id),
 FOREIGN KEY(workspace_id,checkin_id) REFERENCES saas_journal_plan_checkins(workspace_id,id)
);
CREATE INDEX idx_saas_review_followups_latest
 ON saas_review_action_followups(workspace_id,checkin_id,created_at DESC,id DESC);
ALTER TABLE saas_review_action_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_review_action_followups FORCE ROW LEVEL SECURITY;
CREATE POLICY saas_review_followups_read ON saas_review_action_followups FOR SELECT
 USING(workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
CREATE POLICY saas_review_followups_insert ON saas_review_action_followups FOR INSERT
 WITH CHECK(workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid
 AND author_user_id=NULLIF(current_setting('saas.user_id',true),'')::uuid);
GRANT SELECT,INSERT ON saas_review_action_followups TO saas_trade_runtime;
