-- Owner-only authored rationale attached to observed (NOT attested) Tiger
-- orders/individual transactions. This is intentionally NOT the publication
-- proof table from 018 and cannot be used as verified broker evidence.
CREATE TABLE saas_journal_tiger_observation_links (
  workspace_id uuid NOT NULL,
  journal_id uuid NOT NULL,
  author_user_id uuid NOT NULL,
  ticker text NOT NULL CHECK (ticker ~ '^[A-Z0-9.:-]{1,32}$'),
  note_kind text NOT NULL DEFAULT 'TRADE_NOTE' CHECK (note_kind='TRADE_NOTE'),
  account_id uuid NOT NULL,
  source_ref char(64) NOT NULL CHECK (source_ref ~ '^[0-9a-f]{64}$'),
  observation_kind text NOT NULL CHECK (observation_kind IN ('ORDER','FILL')),
  source_status text NOT NULL DEFAULT 'OBSERVED_NOT_VERIFIED'
    CHECK (source_status='OBSERVED_NOT_VERIFIED'),
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,journal_id),
  FOREIGN KEY (workspace_id,journal_id,author_user_id,ticker,note_kind)
    REFERENCES saas_journal_records(workspace_id,id,author_user_id,ticker,entry_kind)
    ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,account_id)
    REFERENCES saas_broker_accounts(workspace_id,id),
  CHECK (source_ref IS NOT NULL)
);
CREATE INDEX idx_tiger_observation_link_lookup
  ON saas_journal_tiger_observation_links (workspace_id,ticker,linked_at DESC);

ALTER TABLE saas_journal_tiger_observation_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_journal_tiger_observation_links FORCE ROW LEVEL SECURITY;
CREATE POLICY tiger_observation_link_read
  ON saas_journal_tiger_observation_links FOR SELECT
  USING (workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
CREATE POLICY tiger_observation_link_insert
  ON saas_journal_tiger_observation_links FOR INSERT
  WITH CHECK (
    workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid
    AND author_user_id=NULLIF(current_setting('saas.user_id',true),'')::uuid
  );
GRANT SELECT,INSERT ON saas_journal_tiger_observation_links TO saas_trade_runtime;
REVOKE UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER
  ON saas_journal_tiger_observation_links FROM saas_trade_runtime;
