"""Tiger partner OAuth2: consent-only, fail-closed and tenant scoped.

Enterprise/agency OAuth2 is distinct from retail SDK 3.8.0 local login.
No Tiger SDK global token cache, RSA user keys or trading methods are used.
Network is limited to static official Tiger HTTPS hosts and GET read endpoints.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from uuid import UUID

from services.saas_api.identity import resolve

_BASE = "https://openapi.tigerfintech.com"
_OAUTH = _BASE + "/oauth2/v1"
_ALLOWED_ACCOUNT = re.compile(r"^[A-Za-z0-9]{5,25}$")
_STATE = re.compile(r"^[A-Za-z0-9_-]{32,128}$")
_SHA256 = re.compile(r"^[a-f0-9]{64}$")
# Ignore tempting "api.trade" scopes even when Tiger permits query operations:
# an order-capable grant must never be present in the read-only service.
_SCOPE = re.compile(r"^[a-z][a-z0-9._:-]{1,90}$")
_FORBIDDEN = re.compile(r"(?:trade|order|write|place|cancel|transfer|withdraw|modify|execute|admin)", re.I)


class TigerError(Exception):
    def __init__(self, code="TIGER_UNAVAILABLE"):
        super().__init__(code)
        self.code = code


def config(environ=None):
    e = os.environ if environ is None else environ
    if e.get("TIGER_PARTNER_OAUTH_APPROVED") != "1" or e.get("TIGER_READ_ONLY_GRANT_VERIFIED") != "1":
        raise TigerError("PROVIDER_APPROVAL_REQUIRED")
    cid, secret = e.get("TIGER_CLIENT_ID", ""), e.get("TIGER_CLIENT_SECRET", "")
    callback = e.get("TIGER_REDIRECT_URI", "")
    scope = e.get("TIGER_APPROVED_READ_SCOPES", "")
    items = scope.split(" ")
    if (not cid or len(secret) < 24 or not callback.startswith("https://")
            or "?" in callback or "#" in callback or len(items) < 1
            or len(set(items)) != len(items)
            or any(not _SCOPE.fullmatch(x) or _FORBIDDEN.search(x) for x in items)):
        raise TigerError("TIGER_CONFIG_INVALID")
    return {"client_id": cid, "client_secret": secret,
            "redirect": callback, "scopes": tuple(items), "audience": e.get("TIGER_AUDIENCE", "openapi")}


def _key():
    value = os.environ.get("TIGER_VAULT_KEY_B64", "")
    try:
        data = base64.b64decode(value, validate=True)
    except Exception as exc:
        raise TigerError("VAULT_UNAVAILABLE") from exc
    if len(data) != 32:
        raise TigerError("VAULT_UNAVAILABLE")
    return data


def seal(value: object, aad: str) -> bytes:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    nonce = secrets.token_bytes(12)
    payload = json.dumps(value, separators=(",", ":"), allow_nan=False).encode()
    return nonce + AESGCM(_key()).encrypt(nonce, payload, aad.encode())


def unseal(value: bytes, aad: str) -> object:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    try:
        return json.loads(AESGCM(_key()).decrypt(value[:12], value[12:], aad.encode()))
    except Exception as exc:
        raise TigerError("VAULT_DECRYPT_FAILED") from exc


def _scope(identity, broker, subject):
    user = resolve(identity, subject)
    if not user or user["role"] != "OWNER":
        raise TigerError("NOT_FOUND")
    # Require a dedicated *independently provisioned* broker runtime DB login.
    flags = broker.execute("""SELECT rolsuper,rolbypassrls,
      pg_has_role(current_user,'saas_broker_runtime','USAGE'),
      has_table_privilege(current_user,'saas_tiger_grants','SELECT')
      FROM pg_roles WHERE rolname=current_user""").fetchone()
    if flags != (False, False, True, True):
        raise TigerError("BROKER_DB_ROLE_REQUIRED")
    broker.execute("SELECT set_config('saas.workspace_id',%s,true)", (user["workspaceId"],))
    return user["workspaceId"]


def _provider_request(url, *, form=None, access_token=None, empty_success=False):
    if not url.startswith(_BASE + "/"):
        raise TigerError("PROVIDER_HOST_DENIED")
    if form is None and access_token is None:
        raise TigerError("PROVIDER_AUTH_REQUIRED")
    data = urllib.parse.urlencode(form).encode() if form is not None else None
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    if access_token is not None:
        headers["Authorization"] = "Bearer " + access_token
    req = urllib.request.Request(url, headers=headers, data=data, method="POST" if data is not None else "GET")
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, request, fp, code, msg, headers, newurl):
            raise TigerError("PROVIDER_REDIRECT_DENIED")
    try:
        with urllib.request.build_opener(NoRedirect).open(req, timeout=8) as response:
            if empty_success:
                if response.read(1):
                    raise TigerError("PROVIDER_RESPONSE_INVALID")
                return {}
            content = response.read(100000)
            if response.read(1):
                raise TigerError("PROVIDER_RESPONSE_TOO_LARGE")
            parsed = json.loads(content)
            if not isinstance(parsed, dict):
                raise TigerError("PROVIDER_RESPONSE_INVALID")
            return parsed
    except urllib.error.HTTPError as exc:
        # Never reveal token, URL or provider response content to client/log.
        if exc.code == 401:
            raise TigerError("REAUTH_REQUIRED") from None
        if exc.code == 403:
            raise TigerError("PROVIDER_ACCESS_DENIED") from None
        if exc.code == 429:
            raise TigerError("PROVIDER_RATE_LIMIT") from None
        raise TigerError("PROVIDER_UNAVAILABLE") from None
    except (OSError, TimeoutError, ValueError) as exc:
        raise TigerError("PROVIDER_UNAVAILABLE") from exc


def _token(form, cfg):
    encoded = {**form, "client_id": cfg["client_id"], "client_secret": cfg["client_secret"]}
    value = _provider_request(_OAUTH + "/token", form=encoded)
    if not isinstance(value.get("access_token"), str) or len(value["access_token"]) < 20:
        raise TigerError("INVALID_TOKEN_RESPONSE")
    granted = value.get("scope")
    if not isinstance(granted, str) or set(cfg["scopes"]) != set(granted.split()):
        raise TigerError("UNSAFE_OR_MISSING_SCOPES")
    if _FORBIDDEN.search(granted) or any(not _SCOPE.fullmatch(x) for x in granted.split()):
        raise TigerError("UNSAFE_OR_MISSING_SCOPES")
    seconds = value.get("expires_in")
    if not isinstance(seconds, int) or isinstance(seconds, bool) or seconds <= 0 or seconds > 86400 * 30:
        raise TigerError("INVALID_TOKEN_EXPIRY")
    return {"access": value["access_token"], "refresh": value.get("refresh_token"),
            "expiry": int(datetime.now(timezone.utc).timestamp()) + seconds,
            "scopes": granted.split()}


def begin(identity, broker, subject):
    cfg = config()
    _key()
    with broker.transaction():
        wid = _scope(identity, broker, subject)
        state = secrets.token_urlsafe(48)
        hashed = hashlib.sha256(state.encode()).hexdigest()
        row = broker.execute("""INSERT INTO saas_broker_connections
          (workspace_id,provider_code,auth_mode,status)
          VALUES (%s,'TIGER','OAUTH2','PENDING_AUTH') RETURNING id""", (wid,)).fetchone()
        conn_id = row[0]
        broker.execute("""INSERT INTO saas_tiger_oauth_attempts
          (workspace_id,state_sha256,connection_id,expires_at)
          VALUES (%s,%s,%s,now() + interval '10 minutes')""",
          (wid, hashed, conn_id))
    url = _OAUTH + "/authorize?" + urllib.parse.urlencode({
        "response_type": "code", "client_id": cfg["client_id"],
        "redirect_uri": cfg["redirect"], "scope": " ".join(cfg["scopes"]),
        "audience": cfg["audience"], "state": state,
    })
    return {"authorizationUrl": url}


def finish(identity, broker, subject, state, code, returned_scopes):
    cfg = config()
    if not isinstance(state, str) or not _STATE.fullmatch(state):
        raise TigerError("INVALID_CALLBACK")
    if not isinstance(code, str) or not 8 <= len(code) <= 2048:
        raise TigerError("INVALID_CALLBACK")
    if not isinstance(returned_scopes, str) or set(returned_scopes.split()) != set(cfg["scopes"]):
        raise TigerError("UNSAFE_OR_MISSING_SCOPES")
    digest = hashlib.sha256(state.encode()).hexdigest()
    # Consume before exchanging code. A failed callback cannot be replayed.
    with broker.transaction():
        wid = _scope(identity, broker, subject)
        row = broker.execute("""UPDATE saas_tiger_oauth_attempts
            SET consumed_at=now() WHERE workspace_id=%s AND state_sha256=%s
            AND consumed_at IS NULL AND expires_at > now()
            RETURNING connection_id""", (wid, digest)).fetchone()
        if not row:
            raise TigerError("STATE_EXPIRED_OR_REPLAYED")
        conn_id = str(row[0])
    token = _token({"grant_type": "authorization_code",
                    "code": code, "redirect_uri": cfg["redirect"]}, cfg)
    with broker.transaction():
        wid = _scope(identity, broker, subject)
        encrypted = seal(token, wid + ":" + conn_id)
        grant = broker.execute("""INSERT INTO saas_tiger_grants
            (workspace_id,connection_id,ciphertext) VALUES (%s,%s,%s)
            RETURNING id""", (wid, conn_id, encrypted)).fetchone()
        broker.execute("""UPDATE saas_broker_connections SET credential_handle=%s,
            granted_scopes=%s, authorization_expires_at=to_timestamp(%s),
            status='CONNECTED',updated_at=now()
            WHERE workspace_id=%s AND id=%s AND status='PENDING_AUTH'""",
            (grant[0], token["scopes"], token["expiry"], wid, conn_id))
    return {"connected": True}


def _get_grant(broker, wid, connection_id):
    row = broker.execute("""SELECT g.ciphertext FROM saas_tiger_grants g
       JOIN saas_broker_connections c ON c.workspace_id=g.workspace_id
        AND c.id=g.connection_id
       WHERE g.workspace_id=%s AND c.id=%s AND c.status='CONNECTED'
       FOR UPDATE OF g""", (wid, connection_id)).fetchone()
    if not row:
        raise TigerError("CONNECTION_NOT_FOUND")
    return unseal(row[0], str(wid) + ":" + str(connection_id))


def _access(broker, wid, connection_id, cfg):
    grant = _get_grant(broker, wid, connection_id)
    if grant["expiry"] <= int(datetime.now(timezone.utc).timestamp()) + 60:
        if not isinstance(grant.get("refresh"), str):
            raise TigerError("REAUTH_REQUIRED")
        rotated = _token({"grant_type": "refresh_token", "refresh_token": grant["refresh"]}, cfg)
        if not rotated.get("refresh"):
            # A provider that rotates tokens must supply the replacement.
            raise TigerError("REAUTH_REQUIRED")
        broker.execute("""UPDATE saas_tiger_grants SET ciphertext=%s
          WHERE workspace_id=%s AND connection_id=%s""",
          (seal(rotated, str(wid) + ":" + str(connection_id)), wid, connection_id))
        broker.execute("""UPDATE saas_broker_connections
          SET granted_scopes=%s,authorization_expires_at=to_timestamp(%s),updated_at=now()
          WHERE workspace_id=%s AND id=%s""",
          (rotated["scopes"], rotated["expiry"], wid, connection_id))
        grant = rotated
    if set(grant["scopes"]) != set(cfg["scopes"]):
        raise TigerError("UNSAFE_OR_MISSING_SCOPES")
    return grant["access"]


def list_connections(identity, broker, subject):
    with broker.transaction():
        wid = _scope(identity, broker, subject)
        rows = broker.execute("""SELECT id,status,authorization_expires_at,last_success_at
          FROM saas_broker_connections WHERE provider_code='TIGER' ORDER BY created_at DESC LIMIT 25""").fetchall()
        accounts = broker.execute("""SELECT id,connection_id,alias FROM saas_broker_accounts
          ORDER BY created_at DESC LIMIT 50""").fetchall()
    return {"provider": "TIGER", "enabled": _ready(),
      "connections": [{"id": str(r[0]),"status": r[1],
        "expiresAt": r[2].isoformat() if r[2] else None,
        "lastSuccessAt": r[3].isoformat() if r[3] else None} for r in rows],
      "accounts": [{"id": str(r[0]),"connectionId": str(r[1]),"alias": r[2]} for r in accounts]}


def _ready():
    try:
        config()
        _key()
        return True
    except TigerError:
        return False


def _account_data(access, account_number, kind):
    if not _ALLOWED_ACCOUNT.fullmatch(account_number):
        raise TigerError("INVALID_ACCOUNT")
    if kind not in ("assets", "positions"):
        raise TigerError("INVALID_READ_KIND")
    uri = _BASE + "/api/v1/accounts/" + urllib.parse.quote(account_number, safe="") + "/" + kind
    response = _provider_request(uri, access_token=access)
    if response.get("code") not in (None, 0, 200, "0", "200") or response.get("data") is None:
        raise TigerError("PROVIDER_ACCOUNT_NOT_AUTHORIZED")
    return response["data"]


def bind_account(identity, broker, subject, connection_id, account_number):
    cfg = config()
    try:
        conn = str(UUID(connection_id))
    except (ValueError, TypeError) as exc:
        raise TigerError("INVALID_CONNECTION") from exc
    if not isinstance(account_number, str) or not _ALLOWED_ACCOUNT.fullmatch(account_number):
        raise TigerError("INVALID_ACCOUNT")
    with broker.transaction():
        wid = _scope(identity, broker, subject)
        access = _access(broker, wid, conn, cfg)
        # The customer's typed identifier is NOT authorization: Tiger must confirm
        # account-specific assets permission with the *customer's* OAuth token.
        _account_data(access, account_number, "assets")
        fp = hmac.new(_key(), ("TIGER:" + account_number).encode(), hashlib.sha256).hexdigest()
        alias = "Tiger ••••" + account_number[-4:]
        row = broker.execute("""INSERT INTO saas_broker_accounts
          (workspace_id,connection_id,external_account_fingerprint,alias)
          VALUES (%s,%s,%s,%s)
          ON CONFLICT (workspace_id,connection_id,external_account_fingerprint)
          DO UPDATE SET alias=EXCLUDED.alias RETURNING id""",
          (wid, conn, fp, alias)).fetchone()
        account_id = str(row[0])
        broker.execute("""INSERT INTO saas_tiger_account_secrets
           (workspace_id,account_id,ciphertext) VALUES (%s,%s,%s)
           ON CONFLICT (workspace_id,account_id)
           DO UPDATE SET ciphertext=EXCLUDED.ciphertext""",
           (wid, account_id, seal({"account": account_number}, wid + ":" + account_id)))
    return {"accountId": account_id, "alias": alias}


def read_account(identity, broker, subject, account_id):
    cfg = config()
    try:
        account_uuid = str(UUID(account_id))
    except (ValueError, TypeError) as exc:
        raise TigerError("INVALID_ACCOUNT") from exc
    with broker.transaction():
        wid = _scope(identity, broker, subject)
        row = broker.execute("""SELECT a.connection_id,a.alias,s.ciphertext
           FROM saas_broker_accounts a
           JOIN saas_tiger_account_secrets s ON s.workspace_id=a.workspace_id
              AND s.account_id=a.id
           WHERE a.workspace_id=%s AND a.id=%s""",
           (wid, account_uuid)).fetchone()
        if not row:
            raise TigerError("ACCOUNT_NOT_FOUND")
        conn_id, alias, cipher = row
        account_number = unseal(cipher, wid + ":" + account_uuid)["account"]
        access = _access(broker, wid, conn_id, cfg)
        assets = _account_data(access, account_number, "assets")
        positions = _account_data(access, account_number, "positions")
        # No pretend backfilled fills: these are point-in-time broker snapshots.
        for kind, payload in (("ASSETS", assets), ("POSITIONS", positions)):
            canonical = json.dumps(payload, sort_keys=True, separators=(",",":"), allow_nan=False).encode()
            evidence = hashlib.sha256(canonical).hexdigest()
            broker.execute("""INSERT INTO saas_tiger_source_snapshots
               (workspace_id,account_id,kind,evidence_sha256,encrypted_payload,completeness)
               VALUES (%s,%s,%s,%s,%s,'SNAPSHOT_ONLY')""",
               (wid,account_uuid,kind,evidence,seal(payload,wid + ":" + account_uuid + ":" + kind)))
        broker.execute("""UPDATE saas_broker_connections SET last_success_at=now(),updated_at=now()
            WHERE workspace_id=%s AND id=%s""", (wid,conn_id))
    # Avoid passing through broker PII, account details, raw position data or money
    # with undocumented API shape. P4 will publish validated typed projections.
    return {"accountId": account_uuid,"alias":alias,"assetsVerified":True,
            "positionsVerified":True,"coverage":"SNAPSHOT_ONLY",
            "historyImported":False,"source":"TIGER_LIVE_READ_ONLY"}


def disconnect(identity, broker, subject, connection_id):
    try:
        conn = str(UUID(connection_id))
    except (ValueError, TypeError) as exc:
        raise TigerError("INVALID_CONNECTION") from exc
    with broker.transaction():
        wid = _scope(identity, broker, subject)
        row = broker.execute("""SELECT status FROM saas_broker_connections
            WHERE workspace_id=%s AND id=%s AND provider_code='TIGER' FOR UPDATE""",
            (wid,conn)).fetchone()
        if not row:
            raise TigerError("CONNECTION_NOT_FOUND")
        # Best-effort provider-side RFC7009 revoke, then ALWAYS remove local
        # credentials. If Tiger cannot be reached, explicitly tell the user to
        # revoke the app in Developer Center (do not falsely claim remote revoke).
        remotely_revoked = False
        try:
            cfg = config()
            grant = _get_grant(broker, wid, conn)
            token = grant.get("refresh") or grant.get("access")
            hint = "refresh_token" if grant.get("refresh") else "access_token"
            if token:
                _provider_request(_OAUTH + "/revoke", form={
                    "token": token, "token_type_hint": hint,
                    "client_id": cfg["client_id"], "client_secret": cfg["client_secret"],
                }, empty_success=True)
                remotely_revoked = True
        except TigerError:
            pass
        broker.execute("DELETE FROM saas_tiger_grants WHERE workspace_id=%s AND connection_id=%s",(wid,conn))
        broker.execute("""DELETE FROM saas_tiger_account_secrets WHERE workspace_id=%s
           AND account_id IN (SELECT id FROM saas_broker_accounts WHERE workspace_id=%s AND connection_id=%s)""",
           (wid,wid,conn))
        broker.execute("""UPDATE saas_broker_connections SET status='DISCONNECTED',
            credential_handle=NULL,granted_scopes='{}',authorization_expires_at=NULL,updated_at=now()
            WHERE workspace_id=%s AND id=%s""",(wid,conn))
    # Remote revocation is separate: Tiger Developer Center owns it until a
    # provider-approved, tested revocation endpoint is supported.
    return {"disconnected": True, "remoteRevocationRequired": not remotely_revoked}
