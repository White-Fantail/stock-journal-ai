-- P1/P2 forward-only: replay/rate protection and append-only user journal.
-- No production or customer data deletion. Existing versions 001-005 immutable.
CREATE TABLE saas_internal_request_nonces (
  nonce_sha256 char(64) PRIMARY KEY CHECK (nonce_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL
);
CREATE INDEX idx_saas_request_nonce_expiry ON saas_internal_request_nonces (expires_at);
CREATE TABLE saas_internal_rate_limits (
  route_subject_sha256 char(64) NOT NULL CHECK (route_subject_sha256 ~ '^[0-9a-f]{64}$'),
  minute_bucket bigint NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  PRIMARY KEY (route_subject_sha256, minute_bucket)
);
CREATE TABLE saas_journal_records (
  workspace_id uuid NOT NULL REFERENCES saas_workspaces(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  author_user_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  entry_kind text NOT NULL CHECK (entry_kind IN (
    'THESIS','STRATEGY','REVIEW','TRADE_NOTE','WATCHLIST_ADD','WATCHLIST_REMOVE'
  )),
  ticker text NOT NULL CHECK (ticker ~ '^[A-Z0-9.:-]{1,32}$'),
  text_content text NOT NULL DEFAULT '',
  trade_event_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,id),
  UNIQUE (workspace_id,idempotency_key),
  FOREIGN KEY (workspace_id,author_user_id)
    REFERENCES saas_workspace_memberships(workspace_id,user_id),
  FOREIGN KEY (workspace_id,trade_event_id)
    REFERENCES saas_trade_events(workspace_id,id),
  CHECK (length(text_content) <= 6000 AND (
    (entry_kind IN ('WATCHLIST_ADD','WATCHLIST_REMOVE') AND text_content = '' AND trade_event_id IS NULL)
    OR (entry_kind IN ('THESIS','STRATEGY','REVIEW','TRADE_NOTE')
        AND length(btrim(text_content)) > 0
        AND (entry_kind = 'TRADE_NOTE' OR trade_event_id IS NULL))
  ))
);
CREATE INDEX idx_saas_journal_feed ON saas_journal_records
  (workspace_id,created_at DESC,id DESC);
CREATE INDEX idx_saas_journal_ticker ON saas_journal_records
  (workspace_id,ticker,created_at DESC);
ALTER TABLE saas_journal_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_journal_records FORCE ROW LEVEL SECURITY;
CREATE POLICY saas_journal_records_read ON saas_journal_records FOR SELECT
  USING (workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
CREATE POLICY saas_journal_records_insert ON saas_journal_records FOR INSERT
  WITH CHECK (
    workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid
    AND author_user_id = NULLIF(current_setting('saas.user_id',true),'')::uuid
  );
GRANT SELECT, INSERT ON saas_journal_records TO saas_trade_runtime;
-- Never grant UPDATE/DELETE on financial or journal events.
