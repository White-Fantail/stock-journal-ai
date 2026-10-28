"""Manual indicator journal. Criteria are pinned to immutable, tenant-owned revisions."""
from datetime import datetime
from decimal import Decimal
from hashlib import sha256
import json
import re
from uuid import UUID, uuid4
from services.saas_api.trades import (
    TradeInputError, TradeConflict, TradeNotFound,
    _confirmed_scope, _runtime_safety, _tenant_scope,
)

SOURCE = "USER_AUTHORED_ONLY"
RULE_COLUMNS = "id,rule_id,definition,created_at"
RECORD_COLUMNS = "id,ticker,side,observed_at_original,trade_event_id,journal_id,observations,note,created_at"
NUMBER = re.compile(r"^-?(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,8})?$")


def uuid(value):
    try:
        return str(UUID(value))
    except (ValueError, TypeError, AttributeError):
        raise TradeInputError("Invalid indicator reference") from None


def text(value, maximum, required=True):
    if not isinstance(value, str) or len(value.strip()) > maximum or (required and not value.strip()):
        raise TradeInputError("Invalid indicator text")
    return value.strip()


def number(value):
    if value is None:
        return None
    if not isinstance(value, str) or not NUMBER.fullmatch(value):
        raise TradeInputError("Invalid indicator number")
    return value  # Preserve typed precision; Decimal is used only for comparison.


def normalize_rule(raw):
    fields = {"idempotencyKey", "ruleId", "expectedRevisionId", "name", "parameters", "timeframe",
              "side", "stage", "operator", "lower", "upper", "condition", "active"}
    if not isinstance(raw, dict) or set(raw) != fields:
        raise TradeInputError("Invalid indicator rule fields")
    out = {"idempotencyKey": uuid(raw["idempotencyKey"]),
           "ruleId": uuid(raw["ruleId"]) if raw["ruleId"] is not None else None,
           "expectedRevisionId": uuid(raw["expectedRevisionId"]) if raw["expectedRevisionId"] is not None else None}
    if bool(out["ruleId"]) != bool(out["expectedRevisionId"]):
        raise TradeInputError("Revision required for rule edits")
    for field, maximum, required in (("name",60,True),("parameters",100,False),
                                     ("timeframe",30,True),("condition",500,False)):
        out[field] = text(raw[field], maximum, required)
    for field, options in (("side", {"BUY","SELL"}), ("stage", {"CONTEXT","TIMING"}),
                           ("operator", {"LTE","GTE","BETWEEN","MANUAL"})):
        if not isinstance(raw[field],str) or raw[field] not in options:
            raise TradeInputError("Invalid indicator option")
        out[field] = raw[field]
    if type(raw["active"]) is not bool:
        raise TradeInputError("Invalid rule state")
    out["active"] = raw["active"]
    out["lower"],out["upper"] = number(raw["lower"]),number(raw["upper"])
    if out["operator"] == "MANUAL":
        if not out["condition"] or out["lower"] is not None or out["upper"] is not None:
            raise TradeInputError("Manual condition requires text only")
    elif out["lower"] is None or (out["operator"] == "BETWEEN" and
            (out["upper"] is None or Decimal(out["lower"]) > Decimal(out["upper"]))):
        raise TradeInputError("Invalid numeric condition")
    elif out["operator"] != "BETWEEN" and out["upper"] is not None:
        raise TradeInputError("Unexpected upper bound")
    return out


def normalize_record(raw):
    fields = {"idempotencyKey","ticker","side","observedAt","tradeEventId","journalId","observations","note"}
    if not isinstance(raw,dict) or set(raw) != fields:
        raise TradeInputError("Invalid indicator record fields")
    out = {"idempotencyKey": uuid(raw["idempotencyKey"])}
    if not isinstance(raw["ticker"],str) or not re.fullmatch(r"[A-Z0-9.:-]{1,32}",raw["ticker"]):
        raise TradeInputError("Invalid ticker")
    if not isinstance(raw["side"],str) or raw["side"] not in {"BUY","SELL"}:
        raise TradeInputError("Invalid side")
    out.update(ticker=raw["ticker"],side=raw["side"])
    stamp = text(raw["observedAt"],40)
    try:
        dt = datetime.fromisoformat(stamp.replace("Z","+00:00"))
        if dt.tzinfo is None or dt.utcoffset() is None:
            raise ValueError()
    except ValueError:
        raise TradeInputError("Observation time requires timezone") from None
    out["observedAt"] = stamp
    for field in ("tradeEventId","journalId"):
        out[field] = uuid(raw[field]) if raw[field] is not None else None
    if out["tradeEventId"] and out["journalId"]:
        raise TradeInputError("Choose one journal or trade link")
    out["note"] = text(raw["note"],1500,False)
    rows = raw["observations"]
    if not isinstance(rows,list) or not 1 <= len(rows) <= 20:
        raise TradeInputError("Select 1 to 20 indicators")
    out["observations"] = []
    for row in rows:
        if not isinstance(row,dict) or set(row) != {"revisionId","value","assessment"}:
            raise TradeInputError("Invalid observation")
        assessment = row["assessment"]
        if not isinstance(assessment,str) or assessment not in {"MET","NOT_MET","UNCERTAIN"}:
            raise TradeInputError("Invalid self assessment")
        out["observations"].append({"revisionId":uuid(row["revisionId"]),
                                   "value":number(row["value"]),"assessment":assessment})
    if len({r["revisionId"] for r in out["observations"]}) != len(rows):
        raise TradeInputError("Duplicate indicator revision")
    return out


def evaluate(rule, value, assessment):
    if rule["operator"] == "MANUAL":
        return assessment, "USER_ASSESSED"
    if value is None:
        return "UNCERTAIN", "MISSING_VALUE"
    val, threshold = Decimal(value), Decimal(rule["lower"])
    met = (val <= threshold if rule["operator"] == "LTE" else
           val >= threshold if rule["operator"] == "GTE" else
           threshold <= val <= Decimal(rule["upper"]))
    return ("MET" if met else "NOT_MET"), "ENTERED_VALUE_COMPARISON"


def rule_row(row):
    return {"id":str(row[0]),"ruleId":str(row[1]),**row[2],"createdAt":row[3].isoformat()}


def record_row(row):
    return {"id":str(row[0]),"ticker":row[1],"side":row[2],"observedAt":row[3],
            "tradeEventId":str(row[4]) if row[4] else None,"journalId":str(row[5]) if row[5] else None,
            "observations":row[6],"note":row[7],"createdAt":row[8].isoformat(),"source":SOURCE}


def _lock(conn, scope):
    # Serialize this tenant's edits/retries and bound the number of registered rules.
    conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s,29))",(scope["workspaceId"],))


def _replay(conn, table, key, digest):
    row = conn.execute(f"SELECT id,request_hash FROM {table} WHERE idempotency_key=%s",(key,)).fetchone()
    if row:
        if row[1].strip() != digest:
            raise TradeConflict("Indicator idempotency mismatch")
        return {"id":str(row[0]),"replayed":True,"source":SOURCE}
    return None


def list_rules(identity, trade, subject):
    scope = _confirmed_scope(identity,subject)
    with trade.transaction():
        _runtime_safety(trade); _tenant_scope(trade,scope)
        rows = trade.execute(f"""SELECT DISTINCT ON (rule_id) {RULE_COLUMNS}
          FROM saas_indicator_rule_revisions ORDER BY rule_id,created_at DESC,id DESC LIMIT 101""").fetchall()
        if len(rows)>100:
            raise TradeConflict("Indicator rule limit exceeded")
    return {"rules":[rule_row(r) for r in rows],"complete":True,"source":SOURCE}


def save_rule(identity, trade, subject, raw):
    value = normalize_rule(raw)
    scope = _confirmed_scope(identity,subject)
    digest = sha256(json.dumps(value,sort_keys=True).encode()).hexdigest()
    with trade.transaction():
        _runtime_safety(trade); _tenant_scope(trade,scope); _lock(trade,scope)
        old = _replay(trade,"saas_indicator_rule_revisions",value["idempotencyKey"],digest)
        if old:
            return old
        rule_id = value["ruleId"] or str(uuid4())
        if value["ruleId"]:
            current = trade.execute("""SELECT id FROM saas_indicator_rule_revisions
              WHERE rule_id=%s ORDER BY created_at DESC,id DESC LIMIT 1""",(rule_id,)).fetchone()
            if not current:
                raise TradeNotFound("Indicator rule unavailable")
            if str(current[0]) != value["expectedRevisionId"]:
                raise TradeConflict("Indicator rule changed; reload before editing")
        elif trade.execute("SELECT count(DISTINCT rule_id) FROM saas_indicator_rule_revisions").fetchone()[0]>=100:
            raise TradeConflict("Maximum 100 registered indicators")
        definition = {k:v for k,v in value.items() if k not in {"idempotencyKey","ruleId","expectedRevisionId"}}
        row = trade.execute("""INSERT INTO saas_indicator_rule_revisions
          (workspace_id,author_user_id,idempotency_key,request_hash,rule_id,definition)
          VALUES (%s,%s,%s,%s,%s,%s::jsonb) RETURNING id""",
          (scope["workspaceId"],scope["userId"],value["idempotencyKey"],digest,rule_id,json.dumps(definition))).fetchone()
    return {"id":str(row[0]),"replayed":False,"source":SOURCE}


def list_records(identity, trade, subject, raw):
    if not isinstance(raw,dict) or set(raw)!={"ticker","tradeEventId","journalId"}:
        raise TradeInputError("Invalid indicator filter")
    ticker = raw["ticker"]
    if ticker is not None and (not isinstance(ticker,str) or not re.fullmatch(r"[A-Z0-9.:-]{1,32}",ticker)):
        raise TradeInputError("Invalid ticker")
    trade_id = uuid(raw["tradeEventId"]) if raw["tradeEventId"] is not None else None
    journal_id = uuid(raw["journalId"]) if raw["journalId"] is not None else None
    scope = _confirmed_scope(identity,subject)
    with trade.transaction():
        _runtime_safety(trade); _tenant_scope(trade,scope)
        rows = trade.execute(f"""SELECT {RECORD_COLUMNS} FROM saas_indicator_records
          WHERE (%s::text IS NULL OR ticker=%s) AND (%s::uuid IS NULL OR trade_event_id=%s)
          AND (%s::uuid IS NULL OR journal_id=%s) ORDER BY created_at DESC,id DESC LIMIT 201""",
          (ticker,ticker,trade_id,trade_id,journal_id,journal_id)).fetchall()
    return {"records":[record_row(r) for r in rows[:200]],"hasMore":len(rows)>200,"source":SOURCE}


def save_record(identity, trade, subject, raw):
    value = normalize_record(raw)
    scope = _confirmed_scope(identity,subject)
    digest = sha256(json.dumps(value,sort_keys=True).encode()).hexdigest()
    with trade.transaction():
        _runtime_safety(trade); _tenant_scope(trade,scope); _lock(trade,scope)
        old = _replay(trade,"saas_indicator_records",value["idempotencyKey"],digest)
        if old:
            return old
        if value["tradeEventId"]:
            linked = trade.execute("SELECT ticker,side,event_kind FROM saas_trade_events WHERE id=%s",
                                   (value["tradeEventId"],)).fetchone()
            if not linked or linked != (value["ticker"],value["side"],"EXECUTION"):
                raise TradeNotFound("Trade unavailable or ticker/side mismatch")
        if value["journalId"]:
            linked = trade.execute("SELECT ticker FROM saas_journal_records WHERE id=%s",(value["journalId"],)).fetchone()
            if not linked or linked[0] != value["ticker"]:
                raise TradeNotFound("Journal unavailable or ticker mismatch")
        snapshots, rule_ids = [],set()
        for observation in value["observations"]:
            row = trade.execute(f"SELECT {RULE_COLUMNS} FROM saas_indicator_rule_revisions WHERE id=%s",
                                (observation["revisionId"],)).fetchone()
            if not row:
                raise TradeNotFound("Indicator revision unavailable")
            rule = rule_row(row)
            if not rule["active"] or rule["side"] != value["side"] or rule["ruleId"] in rule_ids:
                raise TradeInputError("Indicator direction/state mismatch or duplicate rule")
            rule_ids.add(rule["ruleId"])
            assessment,basis = evaluate(rule,observation["value"],observation["assessment"])
            snapshots.append({"rule":rule,"value":observation["value"],"assessment":assessment,"basis":basis})
        row = trade.execute("""INSERT INTO saas_indicator_records
          (workspace_id,author_user_id,idempotency_key,request_hash,ticker,side,observed_at,
           observed_at_original,trade_event_id,journal_id,observations,note)
          VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s) RETURNING id""",
          (scope["workspaceId"],scope["userId"],value["idempotencyKey"],digest,value["ticker"],value["side"],
           datetime.fromisoformat(value["observedAt"].replace("Z","+00:00")),value["observedAt"],
           value["tradeEventId"],value["journalId"],json.dumps(snapshots),value["note"])).fetchone()
    return {"id":str(row[0]),"replayed":False,"source":SOURCE}
