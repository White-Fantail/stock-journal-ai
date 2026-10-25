-- Opaque dispatch queue. No consumer account data or credentials.
CREATE TABLE saas_broker_dispatch_queue (
 workspace_id uuid NOT NULL,
 job_id uuid NOT NULL,
 ready_after timestamptz NOT NULL DEFAULT now(),
 claim_until timestamptz,
 claim_token uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (workspace_id,job_id),
 FOREIGN KEY (workspace_id,job_id)
  REFERENCES saas_broker_backfill_jobs(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX idx_broker_dispatch_due ON saas_broker_dispatch_queue(ready_after,created_at);
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='saas_broker_dispatch_runtime') THEN
  CREATE ROLE saas_broker_dispatch_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='saas_dispatch_app') THEN
  CREATE ROLE saas_dispatch_app LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
   NOREPLICATION NOBYPASSRLS PASSWORD NULL;
 END IF;
END $$;
GRANT USAGE ON SCHEMA public TO saas_broker_dispatch_runtime;
GRANT saas_broker_dispatch_runtime TO saas_dispatch_app;
GRANT SELECT,INSERT,DELETE ON saas_broker_dispatch_queue TO saas_broker_runtime;
GRANT SELECT ON saas_broker_dispatch_queue TO saas_broker_dispatch_runtime;
GRANT UPDATE (ready_after,claim_until,claim_token)
 ON saas_broker_dispatch_queue TO saas_broker_dispatch_runtime;
ALTER TABLE saas_broker_dispatch_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_broker_dispatch_queue FORCE ROW LEVEL SECURITY;
CREATE POLICY dispatch_broker_read ON saas_broker_dispatch_queue
 FOR SELECT TO saas_broker_runtime
 USING (workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
CREATE POLICY dispatch_broker_insert ON saas_broker_dispatch_queue
 FOR INSERT TO saas_broker_runtime
 WITH CHECK (workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
CREATE POLICY dispatch_broker_delete ON saas_broker_dispatch_queue
 FOR DELETE TO saas_broker_runtime
 USING (workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
CREATE POLICY dispatch_worker_read ON saas_broker_dispatch_queue
 FOR SELECT TO saas_broker_dispatch_runtime USING (true);
CREATE POLICY dispatch_worker_update ON saas_broker_dispatch_queue
 FOR UPDATE TO saas_broker_dispatch_runtime USING (true) WITH CHECK (true);
