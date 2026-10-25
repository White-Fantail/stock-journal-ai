-- 007: dedicated tenant journal login. Password is managed by Railway
-- pre-deploy secret injection and is intentionally NOT stored in SQL or Git.
-- LOGIN with NULL password cannot authenticate until configured by the guarded
-- operator/migration predeploy. This is safe for disposable CI and first rollout.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='saas_trade_app') THEN
    CREATE ROLE saas_trade_app LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS PASSWORD NULL;
  END IF;
END
$$;
GRANT saas_trade_runtime TO saas_trade_app;
