-- 005: Remove discontinued SaaS CSV import staging.
-- Forward-only: 004 is immutable applied history and MUST NOT be edited/deleted.
-- Staging has never been enabled in production, but do not assume emptiness:
-- acquire write-blocking locks, then refuse to destroy ANY existing rows.
-- Runs inside the existing schema_admin transaction and advisory lock.
LOCK TABLE public.saas_csv_import_rows, public.saas_csv_import_batches
  IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF (SELECT EXISTS(SELECT 1 FROM public.saas_csv_import_rows LIMIT 1))
     OR (SELECT EXISTS(SELECT 1 FROM public.saas_csv_import_batches LIMIT 1)) THEN
    RAISE EXCEPTION 'CSV staging contains data; refusing automatic table deletion';
  END IF;
END
$$;

DROP TABLE public.saas_csv_import_rows;
DROP TABLE public.saas_csv_import_batches;
