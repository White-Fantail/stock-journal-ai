-- P4 provenance audit v2. Additive, append-only; no public financial publication.
-- Existing issue versions are preserved with conservative UNKNOWN/BLOCKER defaults.
ALTER TABLE saas_reconciliation_issues
  ADD COLUMN category text NOT NULL DEFAULT 'INTEGRITY'
    CHECK (category IN ('COVERAGE','EXECUTION','FEES','CORPORATE_ACTION',
                       'CASH','SNAPSHOT','AUTHORIZATION','INTEGRITY')),
  ADD COLUMN severity text NOT NULL DEFAULT 'BLOCKER'
    CHECK (severity IN ('BLOCKER','REVIEW')),
  ADD COLUMN evidence_scope text NOT NULL DEFAULT 'ACCOUNT'
    CHECK (evidence_scope IN ('ACCOUNT','WINDOW','EXECUTION','SNAPSHOT'));

-- Enforce account agreement and exact immutable source identifiers at the FK boundary.
ALTER TABLE saas_broker_source_stage ADD CONSTRAINT uq_p4_source_stage_identity
  UNIQUE (workspace_id,id,account_id,source_key_hmac,evidence_sha256);

CREATE TABLE saas_reconciliation_source_links (
  workspace_id uuid NOT NULL,
  version_id uuid NOT NULL,
  account_id uuid NOT NULL,
  source_stage_id uuid NOT NULL,
  source_key_hmac char(64) NOT NULL CHECK (source_key_hmac ~ '^[0-9a-f]{64}$'),
  evidence_sha256 char(64) NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (workspace_id,version_id,source_stage_id),
  UNIQUE (workspace_id,version_id,source_key_hmac),
  FOREIGN KEY (workspace_id,version_id,account_id)
    REFERENCES saas_reconciliation_versions(workspace_id,id,account_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,source_stage_id,account_id,source_key_hmac,evidence_sha256)
    REFERENCES saas_broker_source_stage(workspace_id,id,account_id,source_key_hmac,evidence_sha256)
);
CREATE INDEX idx_reconciliation_link_source ON saas_reconciliation_source_links
  (workspace_id,source_stage_id);
GRANT SELECT,INSERT ON saas_reconciliation_source_links TO saas_broker_runtime;
ALTER TABLE saas_reconciliation_source_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_reconciliation_source_links FORCE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_links_tenant ON saas_reconciliation_source_links
  USING (workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid)
  WITH CHECK (workspace_id=NULLIF(current_setting('saas.workspace_id',true),'')::uuid);
REVOKE TRUNCATE,REFERENCES,TRIGGER ON saas_reconciliation_source_links
  FROM saas_broker_runtime;
