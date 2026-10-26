"""Owner-only, one-shot RSA Tiger fund-details read probe (NO database writes).

This runs ONLY in the separate private Railway credential runner with the
explicit opt-in POSITIONARY_PERSONAL_FUND_PROBE_ENABLED=1. It cannot be invoked
from public HTTP or by another tenant. It checks the live response envelope
against a strict bounded contract; it does not certify account history.

Nothing about amounts, source IDs, account numbers, symbols, RSA keys or raw
provider errors is printed or sent to the Positionary web/API services.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import os
import re
import secrets
import sys
from uuid import uuid4

from services.broker_connectors.tiger_financial_evidence import (
    CATEGORIES, FundEvidenceUnavailable, FundWindow, collect_fund_observations,
)
from temporary.tiger_personal.runner import configuration

_OWNER=re.compile(r"^[0-9]{3,255}$")


class PersonalFundsProbeRefused(RuntimeError):
    def __init__(self, code):
        super().__init__(code)
        self.code=code


def _client(tiger_id,account,private_key,env):
    """Only construct Tiger's read API client inside the isolated runner."""
    from tigeropen.tiger_open_config import TigerOpenClientConfig
    from tigeropen.trade.trade_client import TradeClient
    cfg=TigerOpenClientConfig()
    cfg.tiger_id=tiger_id
    cfg.account=account
    cfg.private_key=private_key
    cfg.license=env.get("POSITIONARY_PERSONAL_LICENSE","TBNZ")
    cfg.timeout=10
    cfg.retry_max_tries=1
    return TradeClient(cfg)


def run_fund_probe(env=None, client_factory=None, now=None):
    env=os.environ if env is None else env
    if env.get("POSITIONARY_PERSONAL_FUND_PROBE_ENABLED")!="1":
        raise PersonalFundsProbeRefused("PROBE_DISABLED")
    subject=env.get("POSITIONARY_PERSONAL_GOOGLE_SUBJECT","")
    if not isinstance(subject,str) or not _OWNER.fullmatch(subject):
        raise PersonalFundsProbeRefused("OWNER_MISSING")
    # Reuses validation of the existing isolated RSA owner configuration.
    try:
        tiger_id,account,key=configuration(env)
    except Exception:
        raise PersonalFundsProbeRefused("RSA_CONFIGURATION_UNAVAILABLE") from None
    current=datetime.now(timezone.utc) if now is None else now
    if not isinstance(current,datetime) or current.tzinfo is None or current.utcoffset() is None:
        raise PersonalFundsProbeRefused("TIME_INVALID")
    today=current.astimezone(timezone.utc).date()
    # Fixed short window: no silently expanding query into all account history.
    window=FundWindow(uuid4(),uuid4(),today-timedelta(days=7),today)
    # Transient scope and HMAC secret only; this probe NEVER persists source refs.
    ephemeral_key=secrets.token_bytes(32)
    try:
        client=(_client(tiger_id,account,key,env) if client_factory is None
                else client_factory(tiger_id,account,key))
    except Exception:
        raise PersonalFundsProbeRefused("CLIENT_UNAVAILABLE") from None

    checks=[]
    for category in CATEGORIES:
        try:
            batch=collect_fund_observations(client,window,category,
                                            account=account,
                                            hmac_secret=ephemeral_key)
            checks.append({"category":category,"status":"SHAPE_OBSERVED_UNVERIFIED",
                           "count":len(batch.records),"pages":batch.pages})
        except FundEvidenceUnavailable as exc:
            # The error enum is internal and never echoes provider exception text.
            status=("NO_ROWS_UNVERIFIED" if exc.code=="EMPTY_PAGE_UNVERIFIED" else
                    "PROVIDER_UNAVAILABLE" if exc.code=="PROVIDER_READ_FAILED" else
                    "SOURCE_SHAPE_UNVERIFIED")
            checks.append({"category":category,"status":status,"count":0,"pages":0})
        except Exception:
            checks.append({"category":category,"status":"SOURCE_SHAPE_UNVERIFIED",
                           "count":0,"pages":0})
    return {"source":"OWNER_ONLY_RSA_SHADOW_PROBE",
            "verified":False,"historyComplete":False,
            "scope":"LAST_7_COMPLETE_UTC_DAYS",
            "checks":checks}


def main():
    try:
        result=run_fund_probe()
    except PersonalFundsProbeRefused as exc:
        print("PERSONAL_FUND_PROBE_REFUSED status="+exc.code)
        sys.exit(1)
    # Only aggregate counts and categorical status are allowed in private logs.
    for check in result["checks"]:
        print("PERSONAL_FUND_"+check["category"]+
              " status="+check["status"]+
              " count="+str(check["count"])+" pages="+str(check["pages"]))
    print("PERSONAL_FUND_PROBE_COMPLETE_UNVERIFIED")


if __name__=="__main__":
    main()
