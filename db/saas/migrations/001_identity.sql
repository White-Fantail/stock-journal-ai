-- SaaS-specific isolated schema. DO NOT apply against the legacy Phase 0-2 database.
-- No legacy GitHub portfolio or broker rows are seeded.
CREATE TABLE IF NOT EXISTS saas_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_subject text NOT NULL UNIQUE CHECK (length(google_subject) BETWEEN 3 AND 255),
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 320),
  display_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS saas_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL UNIQUE REFERENCES saas_users(id),
  label text NOT NULL DEFAULT 'My Portfolio',
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,owner_user_id)
);
CREATE TABLE IF NOT EXISTS saas_workspace_memberships (
  workspace_id uuid NOT NULL REFERENCES saas_workspaces(id),
  user_id uuid NOT NULL REFERENCES saas_users(id),
  role text NOT NULL DEFAULT 'OWNER' CHECK (role IN ('OWNER')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_saas_memberships_user
  ON saas_workspace_memberships (user_id, status);
CREATE TABLE IF NOT EXISTS saas_workspace_settings (
  workspace_id uuid PRIMARY KEY REFERENCES saas_workspaces(id),
  timezone text NOT NULL DEFAULT 'UTC',
  base_currency char(3) NOT NULL DEFAULT 'USD',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Future protected rows are scoped to a workspace and never to a global account alias.
-- This table is not writable via the S1 identity API.
CREATE TABLE IF NOT EXISTS saas_journal_entries (
  workspace_id uuid NOT NULL REFERENCES saas_workspaces(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  author_user_id uuid NOT NULL,
  ticker text NOT NULL CHECK (ticker ~ '^[A-Z0-9.:-]{1,32}$'),
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,id),
  FOREIGN KEY (workspace_id,author_user_id)
    REFERENCES saas_workspace_memberships(workspace_id,user_id)
);

-- Explicit RLS: the future application data role must NOT have BYPASSRLS.
-- The identity/provisioning connection can access only identity-related rows
-- through its service code, not a generic SQL execution endpoint.
ALTER TABLE saas_journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_journal_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY saas_journal_workspace_scope ON saas_journal_entries
  USING (workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
