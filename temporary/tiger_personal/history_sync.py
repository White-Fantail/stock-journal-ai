"""Read-only historical STOCK order collector for one private Tiger account.

Order-level observations are NOT broker fills. An order can have multiple fills,
fees/timestamps can be revised, and the 90-day/100-order bounds are enforced.
No order placement, cancellation or cash transfer methods are used.
"""
from __future__ import annotations
import hashlib
import hmac
import json
import os
import re
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4
from temporary.tiger_personal.runner import configuration
from temporary.tiger_personal.sync_ready import amount, _endpoint

PATH="/internal/v1/tiger/personal-orders-import"

def _enum(value):
    if hasattr(value,"value"):
        value=value.value
    return str(value).upper() if value is not None else "UNKNOWN"

def _order(item,account):
    observed=getattr(item,"account",None)
    if observed is not None and str(observed)!=account:
        raise ValueError("ACCOUNT_MISMATCH")
    contract=getattr(item,"contract",None)
    symbol=getattr(contract,"symbol",None)
    currency=_enum(getattr(contract,"currency",None))
    ident=getattr(item,"id",None)
    side=_enum(getattr(item,"action",None))
    status=_enum(getattr(item,"status",None))
    if (not str(ident).isdigit() or not re.fullmatch(r"[A-Z0-9.:-]{1,32}",str(symbol))
        or currency not in ("USD","NZD","AUD","HKD","SGD","EUR","GBP","CAD","JPY","CNY")
        or side not in ("BUY","SELL")):
        raise ValueError("INVALID_ORDER")
    if status not in ("FILLED","PARTIALLY_FILLED","CANCELLED","EXPIRED","REJECTED",
                      "HELD","PENDING","NEW","SUBMITTED","INACTIVE","UNKNOWN"):
        status="UNKNOWN"
    filled=amount(getattr(item,"filled",None))
    if filled is None or Decimal(filled)<0:
        raise ValueError("INVALID_ORDER")
    raw_time=getattr(item,"trade_time",None) or getattr(item,"order_time",None)
    at=str(int(raw_time)) if raw_time is not None else None
    if at is not None and not re.fullmatch(r"[0-9]{13}",at):
        raise ValueError("INVALID_ORDER_TIME")
    return {"id":str(ident),"symbol":str(symbol),"currency":currency,"side":side,
            "status":status,"filled":filled,
            "price":amount(getattr(item,"avg_fill_price",None)),
            "fee":amount(getattr(item,"commission",None)),
            "at":at}

def _send(subject,account,begin,end,part,parts,complete,orders,env):
    base=_endpoint(env)
    secret=env.get("POSITIONARY_PERSONAL_BRIDGE_SECRET","")
    if len(secret)<32:
        raise ValueError("BRIDGE_UNAVAILABLE")
    body=json.dumps({"subject":subject,"account":account,"from":str(begin),
       "to":str(end),"part":part,"parts":parts,"complete":complete,
       "orders":orders},separators=(",",":"),allow_nan=False).encode()
    if len(body)>24576:
        raise ValueError("HISTORY_BODY_TOO_LARGE")
    stamp=str(int(time.time()))
    nonce=str(uuid4())
    sig=hmac.new(secret.encode(),
      f"{stamp}\n{nonce}\nPOST\n{PATH}\n".encode()+body,hashlib.sha256).hexdigest()
    req=urllib.request.Request(base+PATH,data=body,method="POST",headers={
      "Content-Type":"application/json","X-Saas-Timestamp":stamp,
      "X-Saas-Nonce":nonce,"X-Saas-Signature":sig})
    class BlockRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs):
            raise ValueError("REDIRECT_DENIED")
    with urllib.request.build_opener(BlockRedirect()).open(req,timeout=20) as reply:
        if reply.status!=200:
            raise ValueError("HISTORY_NOT_SAVED")
        result=json.loads(reply.read(1024))
    if result.get("saved") is not True or result.get("source")!="PERSONAL_ORDER_OBSERVATION":
        raise ValueError("INVALID_HISTORY_RECEIPT")

def _pages(client,account,begin,end):
    # Unlike get_filled_orders, get_orders supports a cursor.
    from tigeropen.common.consts import SecurityType
    kwargs={"account":account,"sec_type":SecurityType.STK,
            "start_time":begin,"end_time":end,"limit":100}
    seen_tokens=set()
    orders={}
    complete=True
    for _ in range(20):
        response=client.get_orders(**kwargs)
        if isinstance(response,(list,tuple)):
            page=response
            token=None
            # Old list SDK response has no provable next cursor.
            if len(page)>=100:
                complete=False
        else:
            page=getattr(response,"result",None)
            token=getattr(response,"next_page_token",None)
            if not isinstance(page,(list,tuple)):
                raise ValueError("UNEXPECTED_PAGE")
        if len(page)>100:
            raise ValueError("PAGE_LIMIT")
        for raw in page:
            item=_order(raw,account)
            orders[item["id"]]=item
        if not token:
            return list(orders.values()),complete
        if not isinstance(token,str) or token in seen_tokens or len(token)>512:
            raise ValueError("CURSOR_INVALID")
        seen_tokens.add(token)
        kwargs["page_token"]=token
    return list(orders.values()),False

def sync_history(env=None, client_factory=None):
    env=os.environ if env is None else env
    tiger_id,account,key=configuration(env)
    _endpoint(env)
    subject=env.get("POSITIONARY_PERSONAL_GOOGLE_SUBJECT","")
    if not re.fullmatch(r"[0-9]{3,255}",subject):
        raise ValueError("OWNER_MISSING")
    start_text=env.get("POSITIONARY_PERSONAL_HISTORY_START_UTC","2025-01-01")
    if not re.fullmatch(r"20[0-9]{2}-[0-9]{2}-[0-9]{2}",start_text):
        raise ValueError("INVALID_START")
    start=datetime.strptime(start_text,"%Y-%m-%d").replace(tzinfo=timezone.utc)
    now=datetime.now(timezone.utc)
    if start>=now or start.year<2015:
        raise ValueError("INVALID_START")
    if client_factory is None:
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
    else:
        client=client_factory(tiger_id,account,key)
    windows=0
    total=0
    partial=0
    # Use narrow half-open windows; never infer complete history before 2015.
    # Capped at 28 windows per manual job, no unbounded crawl.
    cursor=start
    while cursor<now and windows<28:
        next_date=min(cursor+timedelta(days=85),now)
        begin=int(cursor.timestamp()*1000)
        end=int(next_date.timestamp()*1000)
        rows,complete=_pages(client,account,begin,end)
        parts=max(1,(len(rows)+24)//25)
        if parts>40:
            raise ValueError("TOO_MANY_ORDERS")
        for part in range(parts):
            _send(subject,account,begin,end,part,parts,complete,
                  rows[part*25:(part+1)*25],env)
        total+=len(rows)
        partial+=int(not complete)
        windows+=1
        cursor=next_date
    return {"windows":windows,"orders":total,"partialWindows":partial,
            "rangeComplete":cursor>=now and partial==0}

def main():
    try:
        # Snapshot remains independent of order-history API failures.
        from temporary.tiger_personal.sync_ready import run as sync_snapshot, PilotStepError
        sync_snapshot()
        print("PERSONAL_ASSETS_SYNC_OK")
    except Exception:
        print("PERSONAL_ASSETS_SYNC_FAILED")
    try:
        value=sync_history()
        print("PERSONAL_ORDER_HISTORY_STAGED windows="+str(value["windows"])+
              " orders="+str(value["orders"])+
              " partial_windows="+str(value["partialWindows"]))
    except Exception:
        # Never disclose SDK errors or provider response bodies to logs.
        print("PERSONAL_ORDER_HISTORY_UNAVAILABLE")
        raise SystemExit(1)

if __name__=="__main__":
    main()
