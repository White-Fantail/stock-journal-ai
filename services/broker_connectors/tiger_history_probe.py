"""Offline Tiger enterprise transaction inquiry contract probe.

The published API specifies GET /api/v1/orders/transactions with accountId,
optional orderId, limit up to 100 and Bearer + X-TIGR-UID. It does NOT document
a reliable history cursor, an exhaustive time filter or a stable typed
response. Never interpret a single page as complete history.
No network transport, secrets or request execution is implemented.
"""
from __future__ import annotations

from dataclasses import dataclass
import re

TRANSACTION_PATH="/api/v1/orders/transactions"
DOCUMENTATION="https://enterprise-docs.itigerup.com/reference/get-transactions"
_ACCOUNT=re.compile(r"^[A-Za-z0-9]{5,25}$")
_NUMBER=re.compile(r"^[1-9][0-9]{0,18}$")


class ProbeRejected(ValueError):
    pass


@dataclass(frozen=True)
class InquirySpec:
    path: str
    params: tuple[tuple[str,str],...]
    mandatory_headers: tuple[str,...]
    historical_coverage: str = "UNVERIFIED"
    supports_resumable_cursor: bool = False


def transaction_inquiry(account_id, *, order_id=None, limit=100):
    if not isinstance(account_id,str) or not _ACCOUNT.fullmatch(account_id):
        raise ProbeRejected("INVALID_ACCOUNT")
    if type(limit) is not int or not 1 <= limit <= 100:
        raise ProbeRejected("INVALID_LIMIT")
    params=[("accountId",account_id),("limit",str(limit))]
    if order_id is not None:
        if not isinstance(order_id,str) or not _NUMBER.fullmatch(order_id):
            raise ProbeRejected("INVALID_ORDER")
        params.append(("orderId",order_id))
    return InquirySpec(TRANSACTION_PATH,tuple(params),
                       ("Authorization","X-TIGR-UID"))


def inspect_response_shape(response):
    """Inspect only structural facts, NEVER map undocumented fill fields.

    Returns no records for accounting. Validation must be redacted and
    independently approved before any response can reach the page reader.
    """
    if not isinstance(response,dict) or len(response)>32:
        raise ProbeRejected("INVALID_ENVELOPE")
    code=response.get("code")
    if type(code) not in (int,str) or str(code) not in ("0","200"):
        raise ProbeRejected("PROVIDER_STATUS_UNVERIFIED")
    if "data" not in response:
        raise ProbeRejected("DATA_MISSING")
    data=response["data"]
    if data is None or not isinstance(data,(list,dict)):
        raise ProbeRejected("DATA_SHAPE_UNKNOWN")
    if isinstance(data,list) and len(data)>100:
        raise ProbeRejected("PAGE_LIMIT")
    return {"envelopeAccepted":True,"mapping":"UNVERIFIED",
            "historicalCoverage":"UNVERIFIED",
            "pagination":"UNVERIFIED","publishable":False}
