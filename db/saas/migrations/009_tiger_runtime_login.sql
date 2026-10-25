-- P3 dedicated broker runtime login: no default password; operator sets it
-- in Railway secrets/DB administration after least-privilege verification.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='saas_broker_app') THEN
    CREATE ROLE saas_broker_app LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS PASSWORD NULL;
  END IF;
END $$;
GRANT saas_broker_runtime TO saas_broker_app;
