-- Forward-only Tiger market quote evidence segregation. No historical rows rewritten.
-- QUOTES remain owner-only encrypted SNAPSHOT_ONLY and never enter P4 ledger release.
ALTER TABLE saas_tiger_source_snapshots
  DROP CONSTRAINT saas_tiger_source_snapshots_kind_check;
ALTER TABLE saas_tiger_source_snapshots
  ADD CONSTRAINT saas_tiger_source_snapshots_kind_check
  CHECK (kind IN ('ASSETS','POSITIONS','TRANSACTIONS','QUOTES'));
