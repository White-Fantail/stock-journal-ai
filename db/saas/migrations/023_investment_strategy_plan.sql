-- 023: Long-horizon, user-authored investment plan fields.
-- Only additive nullable columns: preserves all historical immutable revisions,
-- account balances, Tiger sources, and pre-existing idempotency hashes.
-- Plans are NOT broker instructions and never trigger a price or trade alert.
ALTER TABLE saas_journal_plan_revisions
  ADD COLUMN strategy_type text
    CHECK (strategy_type IS NULL OR strategy_type IN
      ('LONG_TERM','TECHNICAL','EVENT_DRIVEN','OTHER')),
  ADD COLUMN investment_horizon text
    CHECK (investment_horizon IS NULL OR investment_horizon IN
      ('UNDER_3_MONTHS','THREE_TO_TWELVE_MONTHS','ONE_TO_THREE_YEARS',
       'OVER_THREE_YEARS','OPEN_ENDED')),
  ADD COLUMN invalidation_condition text
    CHECK (invalidation_condition IS NULL OR
      (char_length(invalidation_condition) BETWEEN 1 AND 1500
       AND length(btrim(invalidation_condition))>0)),
  ADD COLUMN max_allocation_pct numeric(5,2)
    CHECK (max_allocation_pct IS NULL OR
      (max_allocation_pct>0 AND max_allocation_pct<=100)),
  ADD COLUMN review_cadence text
    CHECK (review_cadence IS NULL OR review_cadence IN
      ('WEEKLY','MONTHLY','QUARTERLY','SEMIANNUAL','ANNUAL','EVENT_DRIVEN'));
-- Existing FORCE RLS and SELECT/INSERT-only grants remain in force.
-- No UPDATE, DELETE, broker grant, or market-data dependency is added.
