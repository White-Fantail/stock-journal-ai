-- S3: CSV upload is untrusted source material; validated candidates are REVIEW_ONLY.
-- No automatic promotion into immutable saas_trade_events and no legacy seed.
CREATE TABLE saas_csv_import_batches (
  workspace_id uuid NOT NULL REFERENCES saas_workspaces(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  author_user_id uuid NOT NULL,
  file_fingerprint char(64) NOT NULL CHECK (file_fingerprint ~ '^[0-9a-f]{64}$'),
  row_count integer NOT NULL CHECK (row_count BETWEEN 1 AND 250),
  state text NOT NULL DEFAULT 'PENDING_REVIEW'
    CHECK (state = 'PENDING_REVIEW'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,id),
  UNIQUE (workspace_id,file_fingerprint),
  FOREIGN KEY (workspace_id,author_user_id)
    REFERENCES saas_workspace_memberships(workspace_id,user_id)
);
CREATE TABLE saas_csv_import_rows (
  workspace_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  row_number integer NOT NULL CHECK (row_number BETWEEN 2 AND 251),
  row_fingerprint char(64) NOT NULL CHECK (row_fingerprint ~ '^[0-9a-f]{64}$'),
  ticker text NOT NULL CHECK (ticker ~ '^[A-Z0-9.:-]{1,32}$'),
  side text NOT NULL CHECK (side IN ('BUY','SELL')),
  quantity numeric(30,12) NOT NULL CHECK (quantity > 0),
  price numeric(30,12) NOT NULL CHECK (price > 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  fee numeric(30,12) CHECK (fee IS NULL OR fee >= 0),
  executed_at timestamptz NOT NULL,
  executed_at_source text NOT NULL CHECK (
    executed_at_source ~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
  ),
  PRIMARY KEY (workspace_id,batch_id,row_number),
  UNIQUE (workspace_id,row_fingerprint),
  FOREIGN KEY (workspace_id,batch_id)
    REFERENCES saas_csv_import_batches(workspace_id,id)
);
CREATE INDEX idx_saas_csv_import_recent ON saas_csv_import_batches
  (workspace_id,created_at DESC,id DESC);
ALTER TABLE saas_csv_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_csv_import_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY saas_csv_batch_read ON saas_csv_import_batches FOR SELECT
  USING (workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
CREATE POLICY saas_csv_batch_insert ON saas_csv_import_batches FOR INSERT
  WITH CHECK (
    workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid
    AND author_user_id = NULLIF(current_setting('saas.user_id',true),'')::uuid
  );
ALTER TABLE saas_csv_import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_csv_import_rows FORCE ROW LEVEL SECURITY;
CREATE POLICY saas_csv_row_read ON saas_csv_import_rows FOR SELECT
  USING (workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
CREATE POLICY saas_csv_row_insert ON saas_csv_import_rows FOR INSERT
  WITH CHECK (
    workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid
  );
-- Reuse the existing non-login S2 financial runtime group; no UPDATE/DELETE.
GRANT SELECT, INSERT ON saas_csv_import_batches TO saas_trade_runtime;
GRANT SELECT, INSERT ON saas_csv_import_rows TO saas_trade_runtime;
