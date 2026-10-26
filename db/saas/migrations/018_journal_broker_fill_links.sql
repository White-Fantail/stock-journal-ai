-- P4 forward-only, append-only user-authored journal to certified broker fill.
-- Never edit 001-017. No actual provider data is seeded or copied into journal.
-- Composite FKs prove the user note, verified source, symbol and publication
-- all belong to the SAME workspace and exact original review version.
ALTER TABLE saas_journal_records ADD CONSTRAINT uq_journal_broker_link_parent
  UNIQUE (workspace_id,id,author_user_id,ticker,entry_kind);
ALTER TABLE saas_verified_execution_stage ADD CONSTRAINT uq_broker_fill_link_symbol
  UNIQUE (workspace_id,version_id,source_key_hmac,symbol);

CREATE TABLE saas_journal_broker_fill_links (
  workspace_id uuid NOT NULL,
  journal_id uuid NOT NULL,
  author_user_id uuid NOT NULL,
  ticker text NOT NULL CHECK (ticker ~ '^[A-Z0-9.:-]{1,32}$'),
  note_kind text NOT NULL DEFAULT 'TRADE_NOTE' CHECK (note_kind='TRADE_NOTE'),
  account_id uuid NOT NULL,
  publication_id uuid NOT NULL,
  review_version_id uuid NOT NULL,
  source_key_hmac char(64) NOT NULL CHECK (source_key_hmac ~ '^[0-9a-f]{64}$'),
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,journal_id),
  FOREIGN KEY (workspace_id,journal_id,author_user_id,ticker,note_kind)
    REFERENCES saas_journal_records(workspace_id,id,author_user_id,ticker,entry_kind)
    ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,publication_id,account_id,review_version_id)
    REFERENCES saas_broker_ledger_publications(workspace_id,id,account_id,review_version_id)
    ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,publication_id,source_key_hmac)
    REFERENCES saas_broker_ledger_sources(workspace_id,publication_id,source_key_hmac),
  FOREIGN KEY (workspace_id,review_version_id,source_key_hmac,ticker)
    REFERENCES saas_verified_execution_stage(workspace_id,version_id,source_key_hmac,symbol)
);
CREATE INDEX idx_journal_broker_fill_ticker ON saas_journal_broker_fill_links
  (workspace_id,ticker,linked_at DESC);

ALTER TABLE saas_journal_broker_fill_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_journal_broker_fill_links FORCE ROW LEVEL SECURITY;
CREATE POLICY journal_broker_fill_read ON saas_journal_broker_fill_links FOR SELECT
  USING (workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
CREATE POLICY journal_broker_fill_insert ON saas_journal_broker_fill_links FOR INSERT
  WITH CHECK (
    workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid
    AND author_user_id=NULLIF(current_setting('saas.user_id',true),'')::uuid
  );
GRANT SELECT,INSERT ON saas_journal_broker_fill_links TO saas_trade_runtime;
-- Grant only scoped immutable release facts needed to prove a genuine target.
-- Trade role still cannot decrypt Tiger tokens, stage payloads or publish.
GRANT SELECT (workspace_id,id,account_id,review_version_id,review_version_num)
  ON saas_broker_ledger_publications TO saas_trade_runtime;
GRANT SELECT (workspace_id,publication_id,account_id,review_version_id,source_key_hmac)
  ON saas_broker_ledger_sources TO saas_trade_runtime;
GRANT SELECT (workspace_id,id,account_id,version_num,state)
  ON saas_reconciliation_versions TO saas_trade_runtime;
GRANT SELECT (workspace_id,version_id,source_key_hmac,symbol)
  ON saas_verified_execution_stage TO saas_trade_runtime;
GRANT SELECT (workspace_id,id,connection_id)
  ON saas_broker_accounts TO saas_trade_runtime;
GRANT SELECT (workspace_id,id,provider_code,status,authorization_expires_at,granted_scopes)
  ON saas_broker_connections TO saas_trade_runtime;
REVOKE UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER
  ON saas_journal_broker_fill_links FROM saas_trade_runtime;
