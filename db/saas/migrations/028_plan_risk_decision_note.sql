-- Optional user-approved purchase assumption/note saved with an immutable
-- investment plan revision. This is user-authored narrative, NEVER broker proof.
-- Existing revisions and original request idempotency hashes are untouched.
ALTER TABLE saas_journal_plan_revisions
 ADD COLUMN risk_decision_note text
 CHECK (risk_decision_note IS NULL OR
   (char_length(risk_decision_note) BETWEEN 1 AND 1200 AND
    length(btrim(risk_decision_note))>0));
-- Existing FORCE RLS and INSERT/SELECT-only role remain unchanged.
