-- P3 staging only. No Tiger network access, no source-to-ledger publication.
-- Tenant-scoped durable job, bounded resumable windows, encrypted evidence.
CREATE TABLE saas_broker_backfill_jobs (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  idempotency_key char(64) NOT NULL CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'PENDING'
    CHECK (state IN ('PENDING','RUNNING','PARTIAL','COMPLETE','FAILED','AUTH_REQUIRED')),
  start_utc timestamptz NOT NULL,
  end_utc timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,id),
  UNIQUE (workspace_id,id,account_id),
  UNIQUE (workspace_id,account_id,idempotency_key),
  FOREIGN KEY (workspace_id,account_id) REFERENCES saas_broker_accounts(workspace_id,id) ON DELETE CASCADE,
  CHECK (end_utc > start_utc)
);
CREATE TABLE saas_broker_backfill_windows (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  account_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 255),
  start_utc timestamptz NOT NULL,
  end_utc timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'PENDING'
    CHECK (state IN ('PENDING','RUNNING','PARTIAL','COMPLETE','FAILED','AUTH_REQUIRED')),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  checkpoint_ciphertext bytea CHECK (checkpoint_ciphertext IS NULL OR octet_length(checkpoint_ciphertext) > 28),
  lease_until timestamptz,
  retry_after timestamptz,
  issue_codes text[] NOT NULL DEFAULT '{}',
  finished_at timestamptz,
  PRIMARY KEY (workspace_id,id),
  UNIQUE (workspace_id,id,account_id),
  UNIQUE (workspace_id,job_id,ordinal),
  FOREIGN KEY (workspace_id,job_id,account_id)
    REFERENCES saas_broker_backfill_jobs(workspace_id,id,account_id) ON DELETE CASCADE,
  CHECK (end_utc > start_utc AND end_utc <= start_utc + interval '89 days'),
  CHECK (state <> 'COMPLETE' OR (checkpoint_ciphertext IS NULL AND finished_at IS NOT NULL))
);
CREATE INDEX idx_broker_backfill_claim ON saas_broker_backfill_windows
  (state,retry_after,lease_until) WHERE state IN ('PENDING','RUNNING','PARTIAL');
CREATE TABLE saas_broker_source_stage (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  window_id uuid NOT NULL,
  account_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('ORDER','FILL','CASH','CORPORATE_ACTION')),
  source_key_hmac char(64) NOT NULL CHECK (source_key_hmac ~ '^[0-9a-f]{64}$'),
  evidence_sha256 char(64) NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  encrypted_payload bytea NOT NULL CHECK (octet_length(encrypted_payload) > 28),
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,id),
  FOREIGN KEY (workspace_id,window_id,account_id)
    REFERENCES saas_broker_backfill_windows(workspace_id,id,account_id) ON DELETE CASCADE,
  UNIQUE (workspace_id,account_id,kind,source_key_hmac,evidence_sha256)
);
CREATE INDEX idx_broker_source_stage_account ON saas_broker_source_stage
  (workspace_id,account_id,observed_at DESC);
-- Broker role may progress jobs, not rewrite staged evidence or private trade history.
GRANT SELECT, INSERT ON saas_broker_backfill_jobs TO saas_broker_runtime;
GRANT UPDATE (state,updated_at) ON saas_broker_backfill_jobs TO saas_broker_runtime;
GRANT SELECT, INSERT ON saas_broker_backfill_windows TO saas_broker_runtime;
GRANT UPDATE (state,attempts,checkpoint_ciphertext,lease_until,retry_after,issue_codes,finished_at)
  ON saas_broker_backfill_windows TO saas_broker_runtime;
GRANT SELECT, INSERT ON saas_broker_source_stage TO saas_broker_runtime;
ALTER TABLE saas_broker_backfill_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_broker_backfill_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY broker_backfill_jobs_tenant ON saas_broker_backfill_jobs
  USING (workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
ALTER TABLE saas_broker_backfill_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_broker_backfill_windows FORCE ROW LEVEL SECURITY;
CREATE POLICY broker_backfill_windows_tenant ON saas_broker_backfill_windows
  USING (workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
ALTER TABLE saas_broker_source_stage ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_broker_source_stage FORCE ROW LEVEL SECURITY;
CREATE POLICY broker_source_stage_tenant ON saas_broker_source_stage
  USING (workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
