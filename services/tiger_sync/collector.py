# Split from original Phase 2 shadow collector with unchanged behavior.
# No Tiger credentials, network client creation or canonical ledger writes.
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from .shared import (
    MAX_DAYS, MAX_PAGES, ORDER_PAGE_LIMIT, FILL_PAGE_LIMIT,
    ShadowFailure, UnsupportedTransactions, IncompletePage, checksum, field,
)
from .normalization import order_normalized, fill_normalized, position_normalized

def bounded_call(action, *, delays=(0.2, 0.4)):
    """Retry only transport/timeouts/rate-limit errors, never auth or data errors."""
    for attempt in range(len(delays) + 1):
        try:
            return action()
        except Exception as exc:
            # The Tiger SDK has changed provider exception class names across
            # versions; inspecting only the TYPE avoids logging secret messages.
            transient = (isinstance(exc, (TimeoutError, ConnectionError))
                         or type(exc).__name__ in {
                             "RateLimitError", "RateLimitException",
                             "TooManyRequestsError", "ConnectionError", "ReadTimeout"})
            if not transient:
                raise
            if attempt == len(delays):
                raise IncompletePage("Broker transient/rate-limit retries exhausted") from None
            time.sleep(delays[attempt])


def pages(fetch, *, page_limit=MAX_PAGES, record_limit=100):
    token = ""
    seen = set()
    values = []
    count = 0
    while count < page_limit:
        if token in seen:
            raise IncompletePage("Repeated page cursor")
        seen.add(token)
        response = bounded_call(lambda: fetch(token))
        # The SDK must return a page object, NOT an unbounded list.
        batch = field(response, "result")
        next_token = field(response, "next_page_token")
        if not isinstance(batch, list):
            raise IncompletePage("Missing page result list")
        if len(batch) > record_limit:
            raise IncompletePage("Page exceeds configured item limit")
        if next_token is not None and not isinstance(next_token, str):
            raise IncompletePage("Malformed page cursor")
        values.extend(batch)
        count += 1
        if not next_token:
            if len(batch) == record_limit:
                # Cannot prove completeness when provider returns a full last page
                # with no explicit continuation.
                raise IncompletePage("Page boundary ambiguous at record limit")
            return values, count
        token = next_token
    raise IncompletePage("Pagination exceeded safety limit")


def window(start: datetime, end: datetime):
    if not start.tzinfo or not end.tzinfo or start.utcoffset() is None or end.utcoffset() is None:
        raise ShadowFailure("UTC-qualified date window required")
    if end <= start or (end - start).total_seconds() > MAX_DAYS * 86400:
        raise ShadowFailure("Shadow window must be positive and <=89 days")
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000)


def bounded_windows(start: datetime, end: datetime, *, days: int = MAX_DAYS):
    """Partition a historical UTC interval into contiguous <=89-day windows.

    Return half-open intervals [start, end); callers must record every
    window's completion and must not report full coverage if a batch fails.
    """
    if days < 1 or days > MAX_DAYS:
        raise ShadowFailure("Invalid backfill window size")
    if start.tzinfo is None or end.tzinfo is None:
        raise ShadowFailure("Timezone-qualified backfill bounds required")
    if start.utcoffset() is None or end.utcoffset() is None or end <= start:
        raise ShadowFailure("Invalid backfill bounds")
    cursor = start.astimezone(timezone.utc)
    stop = end.astimezone(timezone.utc)
    batches = []
    while cursor < stop:
        next_cursor = min(cursor + timedelta(days=days), stop)
        window(cursor, next_cursor)
        batches.append((cursor, next_cursor))
        cursor = next_cursor
    return batches


def collect(adapter, start: datetime, end: datetime):
    start_ms, end_ms = window(start, end)
    output = {"ORDER": [], "FILL": [], "POSITION": []}
    issues = []
    orders_pages = fills_pages = 0
    transactions_supported = True
    try:
        orders, orders_pages = pages(
            lambda token: adapter.orders(start_ms, end_ms, token), record_limit=ORDER_PAGE_LIMIT)
        order_map = {}
        order_versions = set()
        for item in orders:
            record = order_normalized(item)
            if Decimal(record["filled_quantity"]) == 0:
                continue
            source_identity = (record["order_id"], checksum(record))
            if source_identity not in order_versions:
                order_versions.add(source_identity)
                output["ORDER"].append((record["order_id"], record))
            order_map[record["order_id"]] = record
        for order_id, order in order_map.items():
            try:
                txs, pcount = pages(
                    lambda token: adapter.transactions(order_id, token),
                    record_limit=FILL_PAGE_LIMIT)
                fills_pages += pcount
                normalized = [fill_normalized(t, expected_order=order_id) for t in txs]
                unique_versions = set()
                distinct_fills = []
                for f in normalized:
                    if f["ticker"] != order["ticker"] or f["side"] != order["side"]:
                        raise ShadowFailure("Transaction contract/action does not match order")
                    version = (f["fill_id"], checksum(f))
                    # Repeated pages can contain the exact same fill; do not
                    # double-count it. Distinct fill IDs at the same time and
                    # price must still remain separate.
                    if version in unique_versions:
                        continue
                    unique_versions.add(version)
                    distinct_fills.append(f)
                    output["FILL"].append((f["fill_id"], f))
                total = sum((Decimal(f["quantity"]) for f in distinct_fills), Decimal(0))
                if total != Decimal(order["filled_quantity"]):
                    issues.append(("FILL_QUANTITY_MISMATCH", order_id,
                                   {"expected": order["filled_quantity"], "received": str(total)}))
                if order["commission_reported"] is not None or order["gst_reported"] is not None:
                    issues.append(("ORDER_FEE_NOT_ALLOCATED", order_id,
                                   {"reason": "order and subfill fee scope not verified"}))
            except UnsupportedTransactions:
                transactions_supported = False
                issues.append(("TRANSACTIONS_UNAVAILABLE", order_id, {"reason": "account permission or segment"}))
            except (ShadowFailure, TypeError, KeyError):
                issues.append(("TRANSACTIONS_INCOMPLETE", order_id, {"reason": "invalid, partial or unpaged response"}))
    except (ShadowFailure, KeyError, TypeError):
        issues.append(("ORDERS_INCOMPLETE", "all", {"reason": "invalid, partial or unpaged response"}))
    try:
        for p in bounded_call(adapter.positions):
            normal = position_normalized(p)
            output["POSITION"].append((normal["ticker"], normal))
    except (ShadowFailure, TypeError, KeyError):
        issues.append(("POSITIONS_UNAVAILABLE", "all", {"reason": "position response invalid"}))

    for kind in ("ORDER", "FILL"):
        seen = {}
        for key, record in output[kind]:
            digest = checksum(record)
            if key in seen and seen[key] != digest:
                issues.append(("CONFLICTING_SOURCE_VERSION", key, {"kind": kind}))
            seen[key] = digest
    for kind, values in output.items():
        for key, record in values:
            if record.get("time_confidence") == "UNVERIFIED":
                issues.append(("UNVERIFIED_TIMEZONE", key, {"kind": kind}))
    # Position snapshots are reference only; never infer historical fills.
    reconciliations = [
        (key, "REFERENCE_ONLY", "Snapshot only; historical execution coverage unverified")
        for key, _ in output["POSITION"]
    ]
    complete = not any(code in {
        "ORDERS_INCOMPLETE", "TRANSACTIONS_INCOMPLETE", "TRANSACTIONS_UNAVAILABLE",
        "FILL_QUANTITY_MISMATCH", "POSITIONS_UNAVAILABLE", "CONFLICTING_SOURCE_VERSION"
    } for code, _, _ in issues)
    return {
        "status": "COMPLETE" if complete else "PARTIAL",
        "orders_pages": orders_pages, "fills_pages": fills_pages,
        "transactions_supported": transactions_supported,
        "records": output, "issues": issues, "reconciliations": reconciliations,
    }
