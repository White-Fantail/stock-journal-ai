-- Nullable author-authored price annotations on immutable plan revisions.
-- Reuses the original tenant FORCE RLS and SELECT/INSERT grants. No old row/hash changed.
ALTER TABLE saas_journal_plan_revisions
 ADD COLUMN price_levels jsonb
 CHECK (price_levels IS NULL OR
   (jsonb_typeof(price_levels)='array' AND jsonb_array_length(price_levels)<=8));
