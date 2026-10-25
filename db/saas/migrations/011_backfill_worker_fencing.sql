-- P3 worker fence. Forward-only extension of immutable migration 010.
-- Every claim issues a fresh opaque lease; stale workers cannot commit results.
ALTER TABLE saas_broker_backfill_windows
  ADD COLUMN lease_token uuid;
GRANT UPDATE (lease_token) ON saas_broker_backfill_windows TO saas_broker_runtime;
CREATE INDEX idx_broker_backfill_window_state ON saas_broker_backfill_windows
  (workspace_id,job_id,state,lease_until,retry_after);
