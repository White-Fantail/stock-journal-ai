"""One-shot pilot snapshot sync. Runs only on a separate private Railway service.

Read query methods only; no order/modify/cancel/transfer calls and no local
token cache. Financial data is sent exclusively to the fixed private service.
"""
from __future__ import annotations
import hashlib
import hmac
import json
import os
import re
import secrets
import sys
import time
import urllib.request
from uuid import uuid4
from decimal import Decimal, InvalidOperation
from temporary.tiger_personal.runner import configuration

_PATH="/internal/v1/tiger/personal-import"

def amount(obj):
    if obj is None:
        return None
    try:
        value=Decimal(str(obj))
    except (ValueError,TypeError,InvalidOperation) as exc:
        raise ValueError("INVALID_AMOUNT") from exc
    if not value.is_finite() or abs(value)>=Decimal("1e24"):
        raise ValueError("INVALID_AMOUNT")
    text=format(value,"f")
    if "." in text:
        text=text.rstrip("0").rstrip(".")
    if "." in text and len(text.split(".")[1])>12:
        raise ValueError("INVALID_PRECISION")
    return "0" if text=="-0" else text

def normalize(assets,positions):
    if not isinstance(assets,(list,tuple)) or not assets:
        raise ValueError("NO_ASSET_PROOF")
    if not isinstance(positions,(list,tuple)) or len(positions)>100:
        raise ValueError("INVALID_POSITION_RESPONSE")
    summary=getattr(assets[0],"summary",None)
    if summary is None:
        raise ValueError("NO_ASSET_PROOF")
    asset={"netLiquidation":amount(getattr(summary,"net_liquidation",None)),
           "cashBalance":amount(getattr(summary,"cash_balance",None))}
    rows=[]
    for p in positions:
        contract=getattr(p,"contract",None)
        symbol=getattr(contract,"symbol",None)
        currency=getattr(contract,"currency",None)
        if hasattr(currency,"value"):
            currency=currency.value
        if (not isinstance(symbol,str) or not re.fullmatch(r"[A-Z0-9.:-]{1,32}",symbol)
                or not isinstance(currency,str) or not re.fullmatch(r"[A-Z]{3}",currency)):
            raise ValueError("UNKNOWN_CONTRACT")
        qty=amount(getattr(p,"position_qty",None))
        if qty is None:
            raise ValueError("NO_POSITION_QUANTITY")
        rows.append({"symbol":symbol,"currency":currency,"quantity":qty,
            "averageCost":amount(getattr(p,"average_cost",None)),
            "marketValue":amount(getattr(p,"market_value",None)),
            "unrealizedPnl":amount(getattr(p,"unrealized_pnl",None))})
    return asset,rows

def _endpoint(env):
    base=env.get("POSITIONARY_PERSONAL_BRIDGE_URL","")
    # Fixed Railway-owned TLS origin; never use an arbitrary user-supplied host.
    if base != "https://positionary-api-production.up.railway.app":
        raise ValueError("INVALID_BRIDGE_DESTINATION")
    return base

def submit(subject,account,asset,positions,env):
    secret=env.get("POSITIONARY_PERSONAL_BRIDGE_SECRET","")
    if len(secret)<32:
        raise ValueError("BRIDGE_DISABLED")
    base=_endpoint(env)
    body=json.dumps({"subject":subject,"account":account,
                     "assets":asset,"positions":positions},
                     separators=(",",":"),allow_nan=False).encode()
    if len(body)>24576:
        raise ValueError("SNAPSHOT_TOO_LARGE")
    stamp=str(int(time.time()))
    nonce=str(uuid4())
    signature=hmac.new(secret.encode(),f"{stamp}\n{nonce}\nPOST\n{_PATH}\n".encode()+body,hashlib.sha256).hexdigest()
    request=urllib.request.Request(base+_PATH,method="POST",data=body,headers={
        "Content-Type":"application/json",
        "X-Saas-Timestamp":stamp,"X-Saas-Nonce":nonce,"X-Saas-Signature":signature})
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs):
            raise ValueError("REDIRECT_FORBIDDEN")
    with urllib.request.build_opener(NoRedirect()).open(request,timeout=15) as resp:
        if resp.status!=200:
            raise ValueError("PILOT_IMPORT_REJECTED")
        result=json.loads(resp.read(2048))
        if result.get("source")!="PERSONAL_SNAPSHOT_ONLY" or result.get("saved") is not True:
            raise ValueError("INVALID_INGEST_RECEIPT")
        return result["count"]

def run(env=None):
    env=os.environ if env is None else env
    tiger_id,account,key=configuration(env)
    # Validate destination and transport secret before loading the trading-capable key.
    _endpoint(env)
    if len(env.get("POSITIONARY_PERSONAL_BRIDGE_SECRET",""))<32:
        raise ValueError("BRIDGE_DISABLED")
    if not re.fullmatch(r"[0-9]{3,255}",env.get("POSITIONARY_PERSONAL_GOOGLE_SUBJECT","")):
        raise ValueError("OWNER_ID_MISSING")
    from tigeropen.tiger_open_config import TigerOpenClientConfig
    from tigeropen.trade.trade_client import TradeClient
    cfg=TigerOpenClientConfig()
    cfg.tiger_id=tiger_id
    cfg.account=account
    cfg.private_key=key
    cfg.license=env.get("POSITIONARY_PERSONAL_LICENSE","TBKIWI")
    cfg.timeout=10
    cfg.retry_max_tries=1
    client=TradeClient(cfg)
    asset,rows=normalize(client.get_assets(account=account),
                         client.get_positions(account=account))
    return submit(env["POSITIONARY_PERSONAL_GOOGLE_SUBJECT"],account,asset,rows,env)

def main():
    try:
        count=run()
        print("PILOT_SNAPSHOT_STAGED count="+str(count))
    except Exception:
        # Third-party SDK exception messages are never exposed (may contain PII).
        print("PILOT_SYNC_UNAVAILABLE")
        sys.exit(1)

if __name__=="__main__":
    main()
