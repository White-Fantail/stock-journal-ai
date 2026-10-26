# Temporary Tiger Personal Pilot

This module supports an owner-only, one-shot Tiger account and stock-position
snapshot while official partner OAuth approval is pending. It is removable.

The normal app, Google account and journal remain unchanged. Pilot records use
existing tenant-scoped encrypted source snapshot tables and are always labeled
SNAPSHOT_ONLY, never verified executions or trading orders. The private Tiger
query runner is a separate Railway service; it has no public domain, no
database login, no automated schedule and no methods for placing orders.

The main Railway API has a small removable signed-ingress handler and a
single-owner read endpoint. The preview route is /private/tiger/personal.

**Activation:** independently verify the Tiger developer account, account type,
private-key format, Google subject, stable encryption vault and broker RLS role.
Keep the signing credential on the isolated runner only. Never copy it to
GitHub, Vercel or the normal API container.

**Removal:** once official OAuth identifies and authorizes the same remote
account, transactionally rebind the existing internal broker account ID to the
official connection. Validate source fingerprints and historical data
completeness. Preserve immutable user journals and all unverified source
evidence. Then delete the pilot service, temporary routes, temporary UI and
pilot-only configuration, restoring the standard API Dockerfile. No schema
rollback and no account/financial-data deletion are permitted.
