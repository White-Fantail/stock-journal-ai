"""Read-only, injected-source Tiger fund-details *observation* contract.

Official Python SDK: get_fund_details(seg_types, fund_type, start, limit,
start_date, end_date). Source is injected by a trusted worker; this module
NEVER constructs TradeClient, reads RSA keys, makes HTTP requests, inserts
DB records, or asserts a complete brokerage ledger. Provider reporting
categories are request filters, NOT independent account verification.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone, date
from decimal import Decimal, InvalidOperation
from hashlib import sha256
import json
import math
import re
from typing import Protocol, Any
from uuid import UUID

from .backfill import source_key

CATEGORIES=("DEPOSIT_WITHDRAW","FOREX","CORPORATE_ACTION")
SEGMENTS=("SEC","FUT")
PAGE_SIZE=50
MAX_PAGES=20
MAX_DAYS=89
_CURRENCY=re.compile(r"^[A-Z]{3}$")
_ID=re.compile(r"^[0-9]{1,24}$")
_DATE=re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
_NUM=re.compile(r"^-?(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$")


class FundEvidenceUnavailable(RuntimeError):
    """Sanitized, code-only refusal. Never include raw provider response."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code=code


class ReadOnlyFunds(Protocol):
    def get_fund_details(self, *, seg_types: list[str], fund_type: str,
                         start: int, limit: int, start_date: str,
                         end_date: str) -> Any: ...


@dataclass(frozen=True)
class FundWindow:
    workspace_id: UUID
    account_id: UUID
    start: date
    end: date

    def __post_init__(self):
        if not isinstance(self.workspace_id,UUID) or not isinstance(self.account_id,UUID):
            raise FundEvidenceUnavailable("ACCOUNT_SCOPE_INVALID")
        if (type(self.start) is not date or type(self.end) is not date
                or self.end<=self.start or (self.end-self.start).days>MAX_DAYS):
            raise FundEvidenceUnavailable("WINDOW_INVALID")


@dataclass(frozen=True)
class FundObservation:
    source_ref: str  # Account/category-specific HMAC; raw ID is NOT returned.
    evidence_sha256: str  # Digest of bounded normalized observation only.
    provider_type: str  # Untrusted provider label, never inferred financial action.
    filter_category: str  # Provider request filter; not a transaction proof.
    segment: str
    currency: str
    amount: str  # Observed provider numeric display; not certified ledger precision.
    business_date: str
    updated_at: str | None
    provenance: str = "BROKER_OBSERVED_UNVERIFIED"
    amount_precision_verified: bool = False


@dataclass(frozen=True)
class FundObservationBatch:
    window: FundWindow
    category: str
    records: tuple[FundObservation,...]
    pages: int
    state: str = "SHADOW_OBSERVED_ONLY"
    history_certified: bool = False


def _rows(response: Any) -> list[dict]:
    # pandas.DataFrame duck type, or fixed test adapter. Never log repr/data.
    if callable(getattr(response,"to_dict",None)):
        try:
            rows=response.to_dict("records")
        except (ValueError,TypeError):
            raise FundEvidenceUnavailable("SOURCE_RESPONSE_INVALID") from None
    else:
        rows=response
    if not isinstance(rows,list) or len(rows)>PAGE_SIZE or not all(
        isinstance(r,dict) for r in rows
    ):
        raise FundEvidenceUnavailable("SOURCE_RESPONSE_INVALID")
    return rows


def _number(raw: Any) -> str:
    if isinstance(raw,bool) or not isinstance(raw,(str,int,float,Decimal)):
        raise FundEvidenceUnavailable("AMOUNT_INVALID")
    if isinstance(raw,float) and not math.isfinite(raw):
        raise FundEvidenceUnavailable("AMOUNT_INVALID")
    try:
        # The Tiger SDK documents float amount fields; converting a float to
        # decimal text does NOT validate exact original economic precision.
        value=Decimal(str(raw))
    except (InvalidOperation,ValueError,TypeError):
        raise FundEvidenceUnavailable("AMOUNT_INVALID") from None
    # Reject extreme exponent / scale before format("f"): an untrusted
    # Decimal("1e999999999") must never allocate a gigabyte-sized string.
    if not value.is_finite() or value.copy_abs()>=Decimal("1e24") or value.as_tuple().exponent<-12:
        raise FundEvidenceUnavailable("AMOUNT_INVALID")
    result=format(value,"f")
    if not _NUM.fullmatch(result):
        raise FundEvidenceUnavailable("AMOUNT_INVALID")
    return result


def _timestamp(raw: Any) -> str | None:
    if raw is None:return None
    if isinstance(raw,bool) or not isinstance(raw,int) or raw<946684800000 or raw>4102444800000:
        raise FundEvidenceUnavailable("SOURCE_TIMESTAMP_INVALID")
    return datetime.fromtimestamp(raw/1000,timezone.utc).isoformat()


def _observation(row: dict,category: str,window: FundWindow,key: bytes) -> FundObservation:
    ident=row.get("id")
    if type(ident) is int:
        ident=str(ident)
    if not isinstance(ident,str) or not _ID.fullmatch(ident):
        raise FundEvidenceUnavailable("SOURCE_ID_INVALID")
    segment=row.get("seg_type")
    currency=row.get("currency")
    date_value=row.get("business_date")
    label=row.get("type")
    if segment not in SEGMENTS or not isinstance(currency,str) or not _CURRENCY.fullmatch(currency):
        raise FundEvidenceUnavailable("SOURCE_CURRENCY_OR_SEGMENT_INVALID")
    if not isinstance(date_value,str) or not _DATE.fullmatch(date_value):
        raise FundEvidenceUnavailable("SOURCE_DATE_INVALID")
    try:
        actual=date.fromisoformat(date_value)
    except ValueError:
        raise FundEvidenceUnavailable("SOURCE_DATE_INVALID") from None
    if not window.start<=actual<window.end:
        raise FundEvidenceUnavailable("SOURCE_OUTSIDE_WINDOW")
    if not isinstance(label,str) or not 1<=len(label)<=100 or any(ord(c)<32 for c in label):
        raise FundEvidenceUnavailable("SOURCE_TYPE_INVALID")
    amount=_number(row.get("amount"))
    updated=_timestamp(row.get("updated_at"))
    body={"category":category,"segment":segment,"currency":currency,
          "amount":amount,"businessDate":date_value,"providerType":label,
          "updatedAt":updated}
    serialized=json.dumps(body,sort_keys=True,separators=(",",":"),ensure_ascii=True)
    digest=sha256(serialized.encode()).hexdigest()
    # Category-separated source IDs avoid collisions across provider domains.
    kind="CORPORATE_ACTION" if category=="CORPORATE_ACTION" else "CASH"
    identity=category+":"+ident
    source_ref=source_key(key,"TIGER",window.account_id,kind,identity)
    return FundObservation(source_ref,digest,label,category,segment,currency,
                           amount,date_value,updated)


def collect_fund_observations(source: ReadOnlyFunds,window: FundWindow,
                              category: str, *, hmac_secret: bytes) -> FundObservationBatch:
    """Return a batch only when all advertised rows and pages validate.

    Empty/unbounded/inconsistent pages fail closed; even a complete snapshot
    is not proof of provider history coverage, grant, or accuracy.
    """
    if not isinstance(window,FundWindow) or category not in CATEGORIES:
        raise FundEvidenceUnavailable("CATEGORY_OR_WINDOW_INVALID")
    if not isinstance(hmac_secret,bytes) or len(hmac_secret)<32:
        raise FundEvidenceUnavailable("SOURCE_KEY_INVALID")
    seen:dict[str,FundObservation]={}
    count=None
    expected_pages=None
    received=0
    for page_index in range(MAX_PAGES):
        # Trusted worker owns the client; enforce only non-mutating method.
        try:
            response=source.get_fund_details(
                seg_types=list(SEGMENTS),fund_type=category,
                start=page_index*PAGE_SIZE,limit=PAGE_SIZE,
                start_date=window.start.isoformat(),end_date=window.end.isoformat())
        except Exception:
            raise FundEvidenceUnavailable("PROVIDER_READ_FAILED") from None
        rows=_rows(response)
        if not rows:
            # An empty DataFrame has no documented pagination metadata.
            # Do not assert a zero-activity history is certified.
            raise FundEvidenceUnavailable("EMPTY_PAGE_UNVERIFIED")
        first=rows[0]
        for row in rows:
            meta=[row.get(k) for k in ("page","limit","item_count","page_count")]
            if any(type(x) is not int for x in meta):
                raise FundEvidenceUnavailable("PAGE_METADATA_INVALID")
            page,size,total,pages=meta
            if (page!=page_index+1 or size!=PAGE_SIZE or total<1
                    or pages<1 or pages>MAX_PAGES or
                    pages!=(total+PAGE_SIZE-1)//PAGE_SIZE):
                raise FundEvidenceUnavailable("PAGE_METADATA_INVALID")
            if count is None:
                count,expected_pages=total,pages
            if total!=count or pages!=expected_pages:
                raise FundEvidenceUnavailable("PAGE_DRIFT")
            normalized=_observation(row,category,window,hmac_secret)
            old=seen.get(normalized.source_ref)
            if old is not None and old!=normalized:
                raise FundEvidenceUnavailable("SOURCE_VERSION_CONFLICT")
            if old is not None:
                raise FundEvidenceUnavailable("SOURCE_DUPLICATE")
            seen[normalized.source_ref]=normalized
        received+=len(rows)
        if page_index+1==expected_pages:
            if received!=count:
                raise FundEvidenceUnavailable("PAGE_COUNT_MISMATCH")
            return FundObservationBatch(window,category,tuple(seen.values()),page_index+1)
        if len(rows)!=PAGE_SIZE:
            raise FundEvidenceUnavailable("PAGE_INCOMPLETE")
    raise FundEvidenceUnavailable("PAGE_LIMIT")
