"""Explicit, non-HTTP pilot-to-official account handoff for later provider approval."""
import hashlib
import hmac
from uuid import UUID
from services.saas_api.tiger_oauth import (
    _scope, _key, _access, _account_data, config, seal, TigerError,
)

def bind_existing_account(identity, broker, subject, pilot_id, oauth_id, number):
    # Official OAuth configuration and read-only provider approval are mandatory.
    cfg=config()
    aid,oid=str(UUID(pilot_id)),str(UUID(oauth_id))
    if not isinstance(number,str) or not number.isalnum() or not 5<=len(number)<=25:
        raise TigerError("INVALID_ACCOUNT")
    with broker.transaction():
        wid=_scope(identity,broker,subject)
        row=broker.execute("""SELECT a.connection_id,a.external_account_fingerprint
          FROM saas_broker_accounts a JOIN saas_broker_connections c
          ON c.workspace_id=a.workspace_id AND c.id=a.connection_id
          WHERE a.workspace_id=%s AND a.id=%s AND c.auth_mode='SIGNATURE'
          AND c.status='PENDING_AUTH' FOR UPDATE OF a""",(wid,aid)).fetchone()
        if not row:
            raise TigerError("NOT_PILOT_ACCOUNT")
        target=broker.execute("""SELECT 1 FROM saas_broker_connections
          WHERE workspace_id=%s AND id=%s AND provider_code='TIGER'
          AND auth_mode='OAUTH2' AND status='CONNECTED' FOR UPDATE""",
          (wid,oid)).fetchone()
        if not target:
            raise TigerError("OFFICIAL_CONNECTION_REQUIRED")
        expected=hmac.new(_key(),("TIGER:"+number).encode(),hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected,row[1]):
            raise TigerError("REMOTE_ACCOUNT_MISMATCH")
        # Verify current grant on the provider's server, not a typed account alone.
        token=_access(broker,wid,oid,cfg)
        _account_data(token,number,"assets")
        present=broker.execute("""SELECT 1 FROM saas_broker_accounts
          WHERE workspace_id=%s AND connection_id=%s
          AND external_account_fingerprint=%s""",(wid,oid,expected)).fetchone()
        if present:
            raise TigerError("DUPLICATE_OFFICIAL_ACCOUNT")
        broker.execute("""UPDATE saas_broker_accounts SET connection_id=%s,
          alias=%s WHERE workspace_id=%s AND id=%s""",
          (oid,"Tiger ••••"+number[-4:],wid,aid))
        broker.execute("""INSERT INTO saas_tiger_account_secrets
          (workspace_id,account_id,ciphertext) VALUES (%s,%s,%s)
          ON CONFLICT (workspace_id,account_id)
          DO UPDATE SET ciphertext=EXCLUDED.ciphertext""",
          (wid,aid,seal({"account":number},wid+":"+aid)))
        broker.execute("""UPDATE saas_broker_connections SET status='DISCONNECTED',
          credential_handle=NULL,updated_at=now()
          WHERE workspace_id=%s AND id=%s AND auth_mode='SIGNATURE'
          AND NOT EXISTS (SELECT 1 FROM saas_broker_accounts
           WHERE workspace_id=%s AND connection_id=%s)""",
          (wid,row[0],wid,row[0]))
    return {"preservedAccountId":aid}
