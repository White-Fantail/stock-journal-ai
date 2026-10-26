"""Personal pilot storage; no credentials, provider network, or ledger publication."""
from __future__ import annotations
import hashlib
import hmac
import json
import re
from services.saas_api.tiger_oauth import _scope, _key, seal

_ACCOUNT = re.compile(r"^[A-Za-z0-9]{5,25}$")

def save_snapshot(identity, broker, subject, account, assets, positions):
    """Stage non-canonical pilot snapshots into the existing encrypted Tiger store."""
    if not isinstance(account,str) or not _ACCOUNT.fullmatch(account):
        raise ValueError("INVALID_ACCOUNT")
    if not isinstance(assets,dict) or not isinstance(positions,list):
        raise ValueError("INVALID_SNAPSHOT")
    if len(positions)>100:
        raise ValueError("INVALID_SNAPSHOT")
    with broker.transaction():
        wid=_scope(identity,broker,subject)
        broker.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", ("tiger-pilot:"+wid,))
        row=broker.execute("""SELECT id FROM saas_broker_connections
          WHERE workspace_id=%s AND provider_code='TIGER'
          AND auth_mode='SIGNATURE' AND status='PENDING_AUTH'
          ORDER BY created_at LIMIT 1 FOR UPDATE""",(wid,)).fetchone()
        if row:
            conn=row[0]
        else:
            conn=broker.execute("""INSERT INTO saas_broker_connections
              (workspace_id,provider_code,auth_mode,status)
              VALUES (%s,'TIGER','SIGNATURE','PENDING_AUTH') RETURNING id""",(wid,)).fetchone()[0]
        fp=hmac.new(_key(),("TIGER:"+account).encode(),hashlib.sha256).hexdigest()
        aid=broker.execute("""INSERT INTO saas_broker_accounts
          (workspace_id,connection_id,external_account_fingerprint,alias)
          VALUES (%s,%s,%s,%s)
          ON CONFLICT (workspace_id,connection_id,external_account_fingerprint)
          DO UPDATE SET alias=EXCLUDED.alias RETURNING id""",
          (wid,conn,fp,"Tiger pilot ••••"+account[-4:])).fetchone()[0]
        for kind,payload in (("ASSETS",assets),("POSITIONS",positions)):
            envelope={"source":"PERSONAL_SNAPSHOT_ONLY","data":payload}
            canonical=json.dumps(envelope,sort_keys=True,separators=(",",":"),allow_nan=False).encode()
            broker.execute("""INSERT INTO saas_tiger_source_snapshots
              (workspace_id,account_id,kind,evidence_sha256,encrypted_payload,completeness)
              VALUES (%s,%s,%s,%s,%s,'SNAPSHOT_ONLY')""",
              (wid,aid,kind,hashlib.sha256(canonical).hexdigest(),
               seal(envelope,wid+":"+str(aid)+":"+kind)))
        broker.execute("""UPDATE saas_broker_connections SET last_success_at=now(),
          updated_at=now() WHERE workspace_id=%s AND id=%s""",(wid,conn))
    return {"saved":True,"source":"PERSONAL_SNAPSHOT_ONLY","count":len(positions)}
