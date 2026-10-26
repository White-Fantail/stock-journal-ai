"""Owner-only, tenant-separated Tiger cron execution health. Never trading."""
from __future__ import annotations
import hashlib
import hmac
import re
from uuid import UUID
from services.saas_api.tiger_oauth import _scope,_key
from temporary.tiger_personal.api import PilotError,owner_only

_ACCOUNT=re.compile(r"^[A-Za-z0-9]{5,25}$")
_ALLOWED={"assets":"assets_status","orders":"orders_status","fills":"fills_status"}
_STATUSES={"assets":{"OK","FAILED"},"orders":{"OK","PARTIAL","FAILED"},
           "fills":{"OK","PARTIAL","UNAVAILABLE"}}

def _validate(data):
    if not isinstance(data,dict) or set(data)!={"subject","account","runId","assets","orders","fills"}:
        raise PilotError("INVALID_HEALTH")
    owner_only(data["subject"])
    account=data["account"]
    if not isinstance(account,str) or not _ACCOUNT.fullmatch(account):
        raise PilotError("INVALID_HEALTH")
    try:
        uid=str(UUID(data["runId"],version=4))
    except (ValueError,TypeError,AttributeError):
        raise PilotError("INVALID_HEALTH") from None
    for k in _ALLOWED:
        if type(data[k]) is not str or data[k] not in _STATUSES[k]:
            raise PilotError("INVALID_HEALTH")
    return account,uid

def import_health(identity,broker,payload):
    account,run_id=_validate(payload)
    with broker.transaction():
        wid=_scope(identity,broker,payload["subject"])
        digest=hmac.new(_key(),("TIGER:"+account).encode(),hashlib.sha256).hexdigest()
        found=broker.execute("""SELECT a.id FROM saas_broker_accounts a
           JOIN saas_broker_connections c ON c.workspace_id=a.workspace_id
             AND c.id=a.connection_id
           WHERE a.workspace_id=%s AND a.external_account_fingerprint=%s
             AND c.provider_code='TIGER' AND c.auth_mode='SIGNATURE'
             AND c.status='PENDING_AUTH' LIMIT 1""",(wid,digest)).fetchone()
        if not found:
            raise PilotError("ACCOUNT_NOT_LINKED")
        inserted=broker.execute("""INSERT INTO saas_tiger_personal_sync_health
          (workspace_id,account_id,run_id,assets_status,orders_status,fills_status)
          VALUES (%s,%s,%s,%s,%s,%s)
          ON CONFLICT (workspace_id,account_id,run_id) DO NOTHING RETURNING id""",
          (wid,found[0],run_id,payload["assets"],payload["orders"],payload["fills"])).fetchone()
    return {"saved":True,"source":"PERSONAL_RUN_HEALTH","new":inserted is not None}

def view_health(identity,broker,subject):
    owner_only(subject)
    with broker.transaction():
        wid=_scope(identity,broker,subject)
        rows=broker.execute("""SELECT a.alias,h.assets_status,h.orders_status,h.fills_status,
                h.reported_at
             FROM saas_tiger_personal_sync_health h
             JOIN saas_broker_accounts a ON a.workspace_id=h.workspace_id
               AND a.id=h.account_id
             JOIN saas_broker_connections c ON c.workspace_id=a.workspace_id
               AND c.id=a.connection_id
             WHERE h.workspace_id=%s AND c.provider_code='TIGER'
               AND c.auth_mode='SIGNATURE' AND c.status='PENDING_AUTH'
             ORDER BY h.reported_at DESC,h.id DESC LIMIT 30""",(wid,)).fetchall()
        accounts=broker.execute("""SELECT a.alias,c.last_success_at
             FROM saas_broker_accounts a JOIN saas_broker_connections c
               ON c.workspace_id=a.workspace_id AND c.id=a.connection_id
             WHERE a.workspace_id=%s AND c.provider_code='TIGER'
               AND c.auth_mode='SIGNATURE' AND c.status='PENDING_AUTH'
             ORDER BY a.created_at LIMIT 5""",(wid,)).fetchall()
    # Latest report is NOT necessarily successful. Separate the last good
    # assets snapshot timestamp from last attempted run, for delayed-sync alerts.
    last={}
    for alias,assets,orders,fills,at in rows:
        if alias not in last:
            last[alias]={"alias":alias,"latestRunAt":at.isoformat(),
                        "assets":assets,"orders":orders,"fills":fills}
    return {"source":"PERSONAL_SYNC_HEALTH","coverageVerified":False,
            "accounts":[{"alias":alias,"lastAssetsAt":success.isoformat() if success else None,
                         "latest":last.get(alias)} for alias,success in accounts]}
