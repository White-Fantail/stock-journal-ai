-- S2 financial events: immutable, tenant-scoped manual execution assertions.
-- New SaaS schema only. No legacy import, account link or financial data is seeded.
-- Hosted DDL is operator-only after explicit approval and backup verification.
CREATE TABLE saas_trade_events (
  workspace_id uuid NOT NULL REFERENCES saas_workspaces(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  author_user_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  event_kind text NOT NULL CHECK (event_kind IN ('EXECUTION','VOID')),
  voids_event_id uuid,
  ticker text,
  side text,
  quantity numeric(30,12),
  price numeric(30,12),
  currency char(3),
  fee numeric(30,12),
  executed_at timestamptz,
  executed_at_source text,
  rationale text,
  provenance text NOT NULL DEFAULT 'USER_ASSERTED'
    CHECK (provenance = 'USER_ASSERTED'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,id),
  UNIQUE (workspace_id,idempotency_key),
  FOREIGN KEY (workspace_id,author_user_id)
    REFERENCES saas_workspace_memberships(workspace_id,user_id),
  FOREIGN KEY (workspace_id,voids_event_id)
    REFERENCES saas_trade_events(workspace_id,id),
  CHECK (
    (
      event_kind = 'EXECUTION' AND voids_event_id IS NULL
      AND ticker IS NOT NULL AND ticker ~ '^[A-Z0-9.:-]{1,32}$'
      AND side IS NOT NULL AND side IN ('BUY','SELL')
      AND quantity IS NOT NULL AND quantity > 0
      AND price IS NOT NULL AND price > 0
      AND currency IS NOT NULL AND currency ~ '^[A-Z]{3}$'
      AND (fee IS NULL OR fee >= 0)
      AND executed_at IS NOT NULL
      AND executed_at_source IS NOT NULL
      AND length(executed_at_source) BETWEEN 19 AND 48
      AND executed_at_source ~
        '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
      AND (rationale IS NULL OR length(rationale) <= 3000)
    )
    OR
    (
      event_kind = 'VOID' AND voids_event_id IS NOT NULL
      AND ticker IS NULL AND side IS NULL AND quantity IS NULL
      AND price IS NULL AND currency IS NULL AND fee IS NULL
      AND executed_at IS NULL AND executed_at_source IS NULL
      AND rationale IS NOT NULL AND length(btrim(rationale)) BETWEEN 1 AND 3000
    )
  )
);

-- A correction may void only an EXECUTION in its own tenant, never a VOID.
-- Default SECURITY INVOKER applies the caller's RLS-scoped SELECT privileges.
CREATE FUNCTION saas_assert_trade_void_target()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event_kind = 'VOID' AND NOT EXISTS (
    SELECT 1 FROM saas_trade_events AS target
    WHERE target.workspace_id = NEW.workspace_id
      AND target.id = NEW.voids_event_id
      AND target.event_kind = 'EXECUTION'
  ) THEN
    RAISE EXCEPTION 'VOID must reference an execution in this workspace'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_saas_assert_trade_void_target
  BEFORE INSERT ON saas_trade_events
  FOR EACH ROW EXECUTE FUNCTION saas_assert_trade_void_target();

CREATE UNIQUE INDEX idx_saas_trade_void_once ON saas_trade_events
  (workspace_id,voids_event_id) WHERE voids_event_id IS NOT NULL;
CREATE INDEX idx_saas_trade_events_feed ON saas_trade_events
  (workspace_id,created_at DESC,id DESC);

ALTER TABLE saas_trade_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_trade_events FORCE ROW LEVEL SECURITY;
CREATE POLICY saas_trade_events_read ON saas_trade_events FOR SELECT
  USING (workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
CREATE POLICY saas_trade_events_insert ON saas_trade_events FOR INSERT
  WITH CHECK (
    workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid
    AND author_user_id = NULLIF(current_setting('saas.user_id',true),'')::uuid
  );

-- The HTTP trade API MUST use an independently provisioned limited LOGIN.
-- Runtime privilege group cannot login, bypass RLS or mutate posted events.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saas_trade_runtime') THEN
    CREATE ROLE saas_trade_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA public TO saas_trade_runtime;
GRANT SELECT, INSERT ON saas_trade_events TO saas_trade_runtime;
-- Intentionally no UPDATE, DELETE, TRUNCATE, CREATE or identity-table grants.
