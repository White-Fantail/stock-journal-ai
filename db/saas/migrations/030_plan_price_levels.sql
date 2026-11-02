-- Nullable user-authored ENTRY and CONFIRM levels on immutable plan revisions.
-- Keep the old 001-029 migration checksums, tenant FORCE RLS and SELECT/INSERT-only grants.
ALTER TABLE saas_journal_plan_revisions
 ADD COLUMN price_levels jsonb
 CHECK (price_levels IS NULL OR
   (jsonb_typeof(price_levels)='array' AND jsonb_array_length(price_levels)<=8));

-- The historical target/stop currency check disallowed a currency when both
-- primary levels were null. A plan with ENTRY/CONFIRM only must retain its
-- explicit currency, without inventing a target or stop or rewriting old rows.
DO $$
DECLARE old_constraint name;
BEGIN
 SELECT conname INTO old_constraint
 FROM pg_constraint
 WHERE conrelid='saas_journal_plan_revisions'::regclass
   AND contype='c'
   AND pg_get_constraintdef(oid) LIKE '%target_price IS NULL%'
   AND pg_get_constraintdef(oid) LIKE '%stop_price IS NULL%'
   AND pg_get_constraintdef(oid) LIKE '%price_currency IS NULL%';
 IF old_constraint IS NULL THEN
   RAISE EXCEPTION 'Expected legacy plan price currency constraint missing';
 END IF;
 EXECUTE format('ALTER TABLE saas_journal_plan_revisions DROP CONSTRAINT %I',old_constraint);
END $$;

ALTER TABLE saas_journal_plan_revisions
 ADD CONSTRAINT saas_plan_price_currency_levels_check
 CHECK (
   (target_price IS NULL AND stop_price IS NULL
     AND (price_levels IS NULL OR price_levels='[]'::jsonb)
     AND price_currency IS NULL)
   OR
   ((target_price IS NOT NULL OR stop_price IS NOT NULL
       OR (price_levels IS NOT NULL AND price_levels<>'[]'::jsonb))
     AND price_currency IS NOT NULL)
 );
