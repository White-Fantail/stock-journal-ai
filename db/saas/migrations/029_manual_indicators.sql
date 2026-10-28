-- User-authored indicator criteria and immutable observations. No market feed.
CREATE TABLE saas_indicator_rule_revisions (
 workspace_id uuid NOT NULL REFERENCES saas_workspaces(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 rule_id uuid NOT NULL,
 author_user_id uuid NOT NULL,
 idempotency_key uuid NOT NULL,
 request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,idempotency_key),
 FOREIGN KEY(workspace_id,author_user_id) REFERENCES saas_workspace_memberships(workspace_id,user_id)
);
CREATE INDEX idx_saas_indicator_rule_latest ON saas_indicator_rule_revisions(workspace_id,rule_id,created_at DESC,id DESC);
CREATE TABLE saas_indicator_records (
 workspace_id uuid NOT NULL REFERENCES saas_workspaces(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 author_user_id uuid NOT NULL,
 idempotency_key uuid NOT NULL,
 request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 ticker text NOT NULL CHECK(ticker ~ '^[A-Z0-9.:-]{1,32}$'),
 side text NOT NULL CHECK(side IN ('BUY','SELL')),
 observed_at timestamptz NOT NULL,
 observed_at_original text NOT NULL,
 trade_event_id uuid,
 journal_id uuid,
 observations jsonb NOT NULL CHECK(jsonb_typeof(observations)='array' AND jsonb_array_length(observations) BETWEEN 1 AND 20),
 note text NOT NULL CHECK(char_length(note)<=1500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,idempotency_key),
 CHECK(trade_event_id IS NULL OR journal_id IS NULL),
 FOREIGN KEY(workspace_id,author_user_id) REFERENCES saas_workspace_memberships(workspace_id,user_id),
 FOREIGN KEY(workspace_id,trade_event_id) REFERENCES saas_trade_events(workspace_id,id),
 FOREIGN KEY(workspace_id,journal_id) REFERENCES saas_journal_records(workspace_id,id)
);
CREATE INDEX idx_saas_indicator_records_ticker ON saas_indicator_records(workspace_id,ticker,created_at DESC,id DESC);
ALTER TABLE saas_indicator_rule_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_indicator_rule_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY indicator_rules_read ON saas_indicator_rule_revisions FOR SELECT
 USING(workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
CREATE POLICY indicator_rules_insert ON saas_indicator_rule_revisions FOR INSERT
 WITH CHECK(workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid AND author_user_id=NULLIF(current_setting('saas.user_id',true),'')::uuid);
ALTER TABLE saas_indicator_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_indicator_records FORCE ROW LEVEL SECURITY;
CREATE POLICY indicator_records_read ON saas_indicator_records FOR SELECT
 USING(workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
CREATE POLICY indicator_records_insert ON saas_indicator_records FOR INSERT
 WITH CHECK(workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid AND author_user_id=NULLIF(current_setting('saas.user_id',true),'')::uuid);
GRANT SELECT,INSERT ON saas_indicator_rule_revisions,saas_indicator_records TO saas_trade_runtime;
