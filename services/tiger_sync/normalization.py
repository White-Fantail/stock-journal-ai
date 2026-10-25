# Split from original Phase 2 shadow collector with unchanged behavior.
# No Tiger credentials, network client creation or canonical ledger writes.
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from .shared import ShadowFailure, field

def decimal(raw, label, *, positive=False):
    if raw is None:
        return None
    try:
        number = Decimal(str(raw))
    except (InvalidOperation, ValueError) as exc:
        raise ShadowFailure(f"Invalid {label}") from exc
    if not number.is_finite() or (positive and number <= 0):
        raise ShadowFailure(f"Non-finite/negative {label}")
    return str(number)


def scaled_quantity(raw, scale, label, *, zero_ok=False):
    """Tiger's legacy integer quantity + base-10 decimal offset.

    The modern decimal `position_qty` field is already scaled and must never
    be scaled again. Only call this for raw `filled`/fill/legacy quantity.
    """
    qty = decimal(raw, label)
    if qty is None:
        raise ShadowFailure(f"Missing {label}")
    if scale is None:
        scale = 0
    if isinstance(scale, bool):
        raise ShadowFailure(f"Invalid {label} scale")
    try:
        places = int(scale)
    except (ValueError, TypeError, OverflowError) as exc:
        raise ShadowFailure(f"Invalid {label} scale") from exc
    if str(scale) not in (str(places), f"{places}.0") or not 0 <= places <= 16:
        raise ShadowFailure(f"Unsupported {label} scale")
    result = Decimal(qty) * (Decimal(10) ** (-places))
    if result < 0 or (not zero_ok and result == 0):
        raise ShadowFailure(f"Out-of-range {label}")
    return str(result)


def timestamp(raw):
    """Offset-bearing time or UTC millisecond epochs only. Naive stays unverified."""
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        if raw < 10**11 or raw > 10**14:
            raise ShadowFailure("Expected Unix milliseconds for broker time")
        result = datetime.fromtimestamp(raw / 1000, timezone.utc)
        return result.isoformat(), "VERIFIED_OFFSET", str(raw)
    if isinstance(raw, str):
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return None, "UNVERIFIED", raw
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            return None, "UNVERIFIED", raw
        return parsed.astimezone(timezone.utc).isoformat(), "VERIFIED_OFFSET", raw
    return None, "UNVERIFIED", str(raw) if raw is not None else None


def identity(value, label):
    if value is None or isinstance(value, bool) or not str(value).strip():
        raise ShadowFailure(f"Missing {label}")
    value = str(value)
    if len(value) > 128:
        raise ShadowFailure(f"Invalid {label} length")
    return value


def order_normalized(obj):
    order_id = identity(field(obj, "id"), "order ID")
    contract = field(obj, "contract")
    symbol = identity(field(contract, "symbol"), "contract symbol").upper()
    side = str(field(obj, "action", "")).upper()
    if side not in ("BUY", "SELL"):
        raise ShadowFailure("Unsupported order action")
    qty = scaled_quantity(field(obj, "filled"), field(obj, "filled_scale", 0),
                          "order filled quantity", zero_ok=True)
    utc, status, raw = timestamp(field(obj, "trade_time"))
    commission = decimal(field(obj, "commission"), "commission")
    gst = decimal(field(obj, "gst"), "GST")
    if commission is not None and Decimal(commission) < 0:
        raise ShadowFailure("Negative commission")
    if gst is not None and Decimal(gst) < 0:
        raise ShadowFailure("Negative GST")
    # Charges may be separate/overlapping; do not sum unverified components.
    return {
        "order_id": order_id, "ticker": symbol, "side": side,
        "filled_quantity": qty,
        "avg_fill_price": decimal(field(obj, "avg_fill_price"), "average price"),
        "commission_reported": commission, "gst_reported": gst,
        "total_fee_verified": None,
        "status": str(field(obj, "status", "UNKNOWN")),
        "time_raw": raw, "time_utc": utc, "time_confidence": status,
        "unit": "USD_UNVERIFIED", "record_kind": "ORDER",
    }


def fill_normalized(obj, *, expected_order):
    order_id = identity(field(obj, "order_id"), "transaction order ID")
    if order_id != expected_order:
        raise ShadowFailure("Transaction returned for a different order")
    fill_id = identity(field(obj, "id"), "transaction fill ID")
    contract = field(obj, "contract")
    symbol = identity(field(contract, "symbol"), "transaction symbol").upper()
    side = str(field(obj, "action", "")).upper()
    if side not in ("BUY", "SELL"):
        raise ShadowFailure("Unsupported fill action")
    qty = scaled_quantity(field(obj, "filled_quantity"),
                          field(obj, "filled_quantity_scale", 0), "fill quantity")
    px = decimal(field(obj, "filled_price"), "fill price", positive=True)
    if qty is None or px is None:
        raise ShadowFailure("Missing fill price/quantity")
    utc, status, raw = timestamp(field(obj, "transacted_at"))
    return {
        "fill_id": fill_id, "order_id": order_id, "ticker": symbol,
        "side": side, "quantity": qty, "price": px,
        "time_raw": raw, "time_utc": utc, "time_confidence": status,
        "fee_allocated": None, "unit": "USD_UNVERIFIED",
        "record_kind": "FILL",
    }


def position_normalized(obj):
    contract = field(obj, "contract")
    symbol = identity(field(contract, "symbol"), "position symbol").upper()
    qty = field(obj, "position_qty", None)
    if qty is None:
        qty = field(obj, "quantity")
    n = (decimal(qty, "position quantity") if field(obj, "position_qty", None) is not None
         else scaled_quantity(qty, field(obj, "position_scale", 0),
                              "legacy position quantity", zero_ok=True))
    if n is None:
        raise ShadowFailure("Missing position quantity")
    return {"ticker": symbol, "quantity": n,
            "currency": str(field(contract, "currency", "UNVERIFIED")),
            "record_kind": "POSITION"}
