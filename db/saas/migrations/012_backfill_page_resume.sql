-- Offline P3 paginated worker: durable per-window page cap and encrypted cursor.
-- Additive only. Applied migrations 001-011 remain immutable.
ALTER TABLE saas_broker_backfill_windows
 ADD COLUMN pages_staged smallint NOT NULL DEFAULT 0
   CHECK (pages_staged BETWEEN 0 AND 50);
GRANT UPDATE (pages_staged) ON saas_broker_backfill_windows TO saas_broker_runtime;
