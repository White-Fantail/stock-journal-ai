"""Tiger quote-source discovery for the existing isolated OWNER RSA runner.

Only calls read-only QuoteClient. Free US-only delayed response is the
symbol/currency eligibility proof. Real-time quote is optional and can only
upgrade a delayed US stock observation when its timestamp is newer.
"""
from __future__ import annotations
import hashlib
import hmac
import json
import re
import time
import urllib.request
from datetime import datetime, timezone
from uuid import uuid4

from temporary.tiger_personal.sync_ready import _endpoint, amount

PATH="/internal/v1/tiger/personal-quotes-import"
US_SYMBOL=re.compile(r"^[A-Z][A-Z0-9.]{0,13}$")


def _table(value):
    """Accept only documented row dictionaries, not polymorphic response envelopes."""
    if hasattr(value,"to_dict"):
        value=value.to_dict(orient="records")
    if not isinstance(value,list) or len(value)>40:
        raise ValueError("INVALID_MARKET_ROWS")
    if not all(isinstance(v,dict) for v in value):
        raise ValueError("INVALID_MARKET_ROWS")
    return value


def _quote(row, symbols, price_field, time_field, mode, now_ms):
    symbol=row.get("symbol")
    price=amount(row.get(price_field))
    stamp=row.get(time_field)
    if (not isinstance(symbol,str) or symbol not in symbols
        or price is None or float(price)<=0 or type(stamp)!=int
        or not 1_500_000_000_000<=stamp<=now_ms+300000
        or now_ms-stamp>14*86400000):
        raise ValueError("INVALID_MARKET_QUOTE")
    return {"symbol":symbol,"currency":"USD","price":price,
            "quoteAt":str(stamp),"mode":mode}


def collect_quotes(client, positions, now_ms=None):
    """Never infer US listings from a USD holding alone.

    A symbol appears only if the US-only free delayed endpoint returns it.
    Failed premium quote access never suppresses its delayed observations.
    """
    now_ms=int(time.time()*1000) if now_ms is None else now_ms
    symbols=sorted({p["symbol"] for p in positions if p["currency"]=="USD"
                    and US_SYMBOL.fullmatch(p["symbol"])})[:40]
    if not symbols:
        return [],"NO_US_SYMBOLS"
    delayed=_table(client.get_stock_delay_briefs(symbols=symbols))
    seen={}
    for row in delayed:
        q=_quote(row,set(symbols),"close","time","US_DELAYED_15M",now_ms)
        if q["symbol"] in seen:
            raise ValueError("DUPLICATE_MARKET_QUOTE")
        seen[q["symbol"]]=q
    if not seen:
        return [],"NO_US_QUOTE"
    try:
        premium=_table(client.get_stock_briefs(list(seen),include_hour_trading=False))
        candidates={}
        for row in premium:
            q=_quote(row,set(seen),"latest_price","latest_time","REALTIME_PERMISSIONED",now_ms)
            if q["symbol"] in candidates:
                raise ValueError("DUPLICATE_MARKET_QUOTE")
            candidates[q["symbol"]]=q
        for symbol,q in candidates.items():
            if int(q["quoteAt"])>=int(seen[symbol]["quoteAt"]):
                seen[symbol]=q
    except Exception:
        # Missing entitlement, unusual payload, or offline response: keep free
        # delayed quotes. Never classify unknown data as real-time.
        pass
    return list(seen.values()),"OBSERVED"


def _post(subject,account,quotes,env):
    secret=env.get("POSITIONARY_PERSONAL_BRIDGE_SECRET","")
    if len(secret)<32:
        raise ValueError("BRIDGE_UNAVAILABLE")
    raw=json.dumps({"subject":subject,"account":account,"quotes":quotes},
                   separators=(",",":"),allow_nan=False).encode()
    if len(raw)>24576:
        raise ValueError("QUOTE_BODY_TOO_LARGE")
    stamp,nonce=str(int(time.time())),str(uuid4())
    sig=hmac.new(secret.encode(),
        f"{stamp}\n{nonce}\nPOST\n{PATH}\n".encode()+raw,
        hashlib.sha256).hexdigest()
    request=urllib.request.Request(_endpoint(env)+PATH,method="POST",data=raw,
      headers={"Content-Type":"application/json","X-Saas-Timestamp":stamp,
               "X-Saas-Nonce":nonce,"X-Saas-Signature":sig})
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs):
            raise ValueError("REDIRECT_DENIED")
    with urllib.request.build_opener(NoRedirect()).open(request,timeout=20) as response:
        if response.status!=200:
            raise ValueError("QUOTE_NOT_STORED")
        reply=json.loads(response.read(1024))
    if reply.get("saved") is not True or reply.get("source")!="PERSONAL_QUOTE_OBSERVATION":
        raise ValueError("INVALID_QUOTE_RECEIPT")


def sync_quotes(env,config,positions,quote_factory=None):
    subject,account=env.get("POSITIONARY_PERSONAL_GOOGLE_SUBJECT",""),env.get("POSITIONARY_PERSONAL_ACCOUNT","")
    if not re.fullmatch(r"[0-9]{3,255}",subject):
        raise ValueError("OWNER_MISSING")
    if quote_factory is None:
        from tigeropen.quote.quote_client import QuoteClient
        quote_factory=QuoteClient
    quote_client=quote_factory(config)
    quotes,status=collect_quotes(quote_client,positions)
    if quotes:
        _post(subject,account,quotes,env)
    return {"status":status,"count":len(quotes),
            "realtime":sum(q["mode"]=="REALTIME_PERMISSIONED" for q in quotes),
            "delayed":sum(q["mode"]=="US_DELAYED_15M" for q in quotes)}
