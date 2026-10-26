"""S2: synthetic tenant A/B accounting and RLS integration, disposable PG only."""
from __future__ import annotations

import os
import pathlib
import sys
from uuid import uuid4

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import psycopg

from services.saas_api.identity import provision, resolve
from services.saas_api.journal import create_note, list_notes, export_journal
from services.saas_api.journal_plans import create_plan,list_plans
from services.saas_api.account import delete_account
from services.saas_api.request_security import consume_signed_request, RequestRejected
from services.saas_api.trades import (
    TradeConflict, TradeNotFound, TradeInputError, _runtime_safety,
    create_trade, list_trades,
)


def assertion(key: str, symbol: str = "TSLA") -> dict:
    return {
        "idempotencyKey": key, "kind": "EXECUTION", "confirm": True,
        "ticker": symbol, "side": "BUY", "quantity": "1.25",
        "price": "200.50", "currency": "USD", "fee": None,
        "executedAt": "2026-10-23T15:45:00-04:00",
        "rationale": "Synthetic fixture only",
    }


def main() -> None:
    if os.environ.get("SAAS_TEST_DB_ACK") != "YES_DISPOSABLE_SAAS_DB":
        raise SystemExit("Refused: this is a disposable DB-only integration test")
    with psycopg.connect(os.environ["SAAS_DATABASE_URL"]) as identity, \
         psycopg.connect(os.environ["SAAS_DATABASE_URL"]) as trade:
        a_sub, b_sub = "1000000000911", "1000000000912"
        a = provision(identity, {
            "subject": a_sub, "email": "s2a@example.invalid",
            "name": "S2 A", "email_verified": True,
        })
        b = provision(identity, {
            "subject": b_sub, "email": "s2b@example.invalid",
            "name": "S2 B", "email_verified": True,
        })
        # The privileged admin DB connection must always be refused by the
        # financial service, regardless of a valid Google subject.
        try:
            list_trades(identity, identity, a_sub)
        except PermissionError:
            pass
        else:
            raise AssertionError("Financial service accepted superuser/owner role")

        trade.execute("SET ROLE saas_trade_runtime")
        trade.commit()
        _runtime_safety(trade)
        trade.commit()

        same_key = str(uuid4())
        first = create_trade(identity, trade, a_sub, assertion(same_key))
        again = create_trade(identity, trade, a_sub, assertion(same_key))
        assert first["id"] == again["id"] and again["replayed"]
        try:
            create_trade(identity, trade, a_sub, assertion(same_key, "NVDA"))
        except TradeConflict:
            pass
        else:
            raise AssertionError("Conflicting idempotency key was silently reused")
        assert len(list_trades(identity, trade, a_sub)["events"]) == 1
        assert len(list_trades(identity, trade, b_sub)["events"]) == 0

        bfirst = create_trade(identity, trade, b_sub, assertion(same_key, "RKLB"))
        assert bfirst["id"] != first["id"], "Cross-tenant idempotency collision"
        try:
            create_trade(identity, trade, a_sub, {
                "kind": "VOID", "confirm": True, "idempotencyKey": str(uuid4()),
                "voidsEventId": bfirst["id"], "rationale": "forged other tenant",
            })
        except TradeNotFound:
            pass
        else:
            raise AssertionError("A could void B execution")
        void_request = {
            "kind": "VOID", "confirm": True, "idempotencyKey": str(uuid4()),
            "voidsEventId": first["id"], "rationale": "Correct a confirmed mistake",
        }
        result = create_trade(identity, trade, a_sub, void_request)
        assert not result["replayed"]
        assert create_trade(identity, trade, a_sub, void_request)["replayed"]
        try:
            create_trade(identity, trade, a_sub, {
                **void_request, "idempotencyKey": str(uuid4()),
            })
        except TradeConflict:
            pass
        else:
            raise AssertionError("Duplicate void event was allowed")
        assert len(list_trades(identity, trade, a_sub)["events"]) == 2
        assert len(list_trades(identity, trade, b_sub)["events"]) == 1

        # The P2 authored journal is separate from broker source facts.
        note_key = str(uuid4())
        note = {"idempotencyKey":note_key,"kind":"THESIS","ticker":"TSLA",
                "content":"Synthetic hypothesis only","tradeEventId":first["id"]}
        try:
            create_note(identity, trade, a_sub, note)
        except TradeInputError:
            pass  # THESIS must not point at an execution; enforce typed contract
        else:
            raise AssertionError("THESIS allowed a trade reference")
        note["tradeEventId"] = None
        saved = create_note(identity,trade,a_sub,note)
        assert create_note(identity,trade,a_sub,note)["replayed"]
        assert len(list_notes(identity,trade,a_sub)["entries"]) == 1
        assert len(list_notes(identity,trade,b_sub)["entries"]) == 0
        try:
            create_note(identity,trade,b_sub,{"idempotencyKey":str(uuid4()),
                "kind":"TRADE_NOTE","ticker":"TSLA","content":"forged reference",
                "tradeEventId":first["id"]})
        except TradeNotFound:
            pass
        else:
            raise AssertionError("Cross-tenant trade-note reference accepted")
        plan={"idempotencyKey":str(uuid4()),"ticker":"TSLA",
              "targetPrice":"280.250","stopPrice":"120.500","priceCurrency":"USD",
              "rationale":"Synthetic user-authored plan"}
        planned=create_plan(identity,trade,a_sub,plan)
        assert create_plan(identity,trade,a_sub,plan)["replayed"]
        assert len(list_plans(identity,trade,a_sub)["plans"])==1
        assert list_plans(identity,trade,b_sub)["plans"]==[]
        try:
            create_plan(identity,trade,a_sub,{**plan,"stopPrice":"100"})
        except TradeConflict:
            pass
        else:
            raise AssertionError("Plan idempotency collision silently rewrote data")
        next_plan={**plan,"idempotencyKey":str(uuid4()),"stopPrice":None,
                   "rationale":"Synthetic revised exit plan"}
        create_plan(identity,trade,a_sub,next_plan)
        assert len(list_plans(identity,trade,a_sub)["plans"])==2
        # New P1 long-horizon strategy fields remain immutable and tenant-scoped.
        strategic={**next_plan,"idempotencyKey":str(uuid4()),
            "targetPrice":None,"priceCurrency":None,
            "strategyType":"LONG_TERM","investmentHorizon":"OVER_THREE_YEARS",
            "invalidationCondition":"Synthetic business assumption invalidated",
            "maxAllocationPct":"15.25","reviewCadence":"QUARTERLY",
            "rationale":"Synthetic strategic revision"}
        created_strategy=create_plan(identity,trade,a_sub,strategic)
        assert not created_strategy["replayed"]
        assert create_plan(identity,trade,a_sub,strategic)["replayed"]
        mine=list_plans(identity,trade,a_sub)["plans"]
        assert len(mine)==3 and mine[0]["strategyType"]=="LONG_TERM"
        assert mine[0]["maxAllocationPct"]=="15.25"
        assert mine[1]["strategyType"] is None # historical values stay unset
        assert list_plans(identity,trade,b_sub)["plans"]==[]
        try:
            create_plan(identity,trade,a_sub,{**strategic,"reviewCadence":"WEEKLY"})
        except TradeConflict:
            pass
        else:
            raise AssertionError("Strategy idempotency collision changed immutable history")
        export = export_journal(identity,trade,a_sub)
        assert export["complete"] and len(export["journal"]) == 1 and len(export["trades"]) == 2
        assert len(export["plans"])==3
        assert any(p["maxAllocationPct"]=="15.25" for p in export["plans"])
        assert len(export_journal(identity,trade,b_sub)["journal"]) == 0
        assert export_journal(identity,trade,b_sub)["plans"]==[]

        # Exercise actual SQL constraints as an underprivileged tenant-bound
        # role. This catches regressions even if Python input validation passes.
        executed_at = "2026-10-20T00:00:00+00:00"
        valid = ("TSLA", "BUY", "1.25", "20.50", "USD", None, executed_at)
        bad_rows = [
            ("missing quantity", ("TSLA", "BUY", None, "20.50", "USD", None, executed_at)),
            ("zero quantity", ("TSLA", "BUY", "0", "20.50", "USD", None, executed_at)),
            ("missing price", ("TSLA", "BUY", "1.25", None, "USD", None, executed_at)),
            ("negative price", ("TSLA", "BUY", "1.25", "-1", "USD", None, executed_at)),
            ("unknown ticker", ("tsla", "BUY", "1.25", "20.50", "USD", None, executed_at)),
            ("missing side", ("TSLA", None, "1.25", "20.50", "USD", None, executed_at)),
            ("bad currency", ("TSLA", "BUY", "1.25", "20.50", "US1", None, executed_at)),
            ("negative fee", ("TSLA", "BUY", "1.25", "20.50", "USD", "-1", executed_at)),
            ("missing timezone", ("TSLA", "BUY", "1.25", "20.50", "USD", None,
                                  "2026-10-20T00:00:00")),
            ("missing time source", ("TSLA", "BUY", "1.25", "20.50", "USD", None, None)),
        ]
        with trade.transaction():
            trade.execute("SELECT set_config('saas.workspace_id',%s,true)", (a["workspaceId"],))
            trade.execute("SELECT set_config('saas.user_id',%s,true)", (a["userId"],))
            for label, row_values in bad_rows:
                try:
                    with trade.transaction():
                        trade.execute("""INSERT INTO saas_trade_events
                            (workspace_id, author_user_id, idempotency_key,
                             request_hash, event_kind, ticker, side, quantity,
                             price, currency, fee, executed_at, executed_at_source)
                            VALUES (%s,%s,%s,%s,'EXECUTION',%s,%s,%s,%s,%s,%s,%s,%s)""",
                            (a["workspaceId"], a["userId"], str(uuid4()),
                             "f" * 64, *row_values[:6], executed_at, row_values[6]))
                except psycopg.errors.CheckViolation:
                    pass
                else:
                    raise AssertionError("SQL accepted invalid execution: " + label)
            # The database trigger (not just the Python service) must reject
            # an attempt to void an existing VOID event.
            try:
                with trade.transaction():
                    trade.execute("""INSERT INTO saas_trade_events
                        (workspace_id,author_user_id,idempotency_key,request_hash,
                         event_kind,voids_event_id,rationale)
                        VALUES (%s,%s,%s,%s,'VOID',%s,'invalid nested correction')""",
                        (a["workspaceId"], a["userId"], str(uuid4()),
                         "f" * 64, result["id"]))
            except psycopg.errors.CheckViolation:
                pass
            else:
                raise AssertionError("SQL allowed a VOID targeting another VOID")
        assert len(list_trades(identity, trade, a_sub)["events"]) == 2

        with trade.transaction():
            trade.execute("SELECT set_config('saas.workspace_id','',true)")
            trade.execute("SELECT set_config('saas.user_id','',true)")
            assert trade.execute("SELECT count(*) FROM saas_trade_events").fetchone()[0] == 0
        # SQL-level spoofed workspace and author are blocked even with valid UUIDs.
        with trade.transaction():
            trade.execute("SELECT set_config('saas.workspace_id',%s,true)", (a["workspaceId"],))
            trade.execute("SELECT set_config('saas.user_id',%s,true)", (a["userId"],))
            try:
                with trade.transaction():
                    trade.execute("""INSERT INTO saas_trade_events
                        (workspace_id,author_user_id,idempotency_key,request_hash,event_kind,
                         ticker,side,quantity,price,currency,executed_at,executed_at_source)
                        VALUES (%s,%s,%s,%s,'EXECUTION',
                                'NVDA','BUY',1,2,'USD','2026-10-20T00:00:00Z',
                                '2026-10-20T00:00:00+00:00')""",
                        (b["workspaceId"], b["userId"], str(uuid4()), "a" * 64))
            except psycopg.errors.InsufficientPrivilege:
                pass
            else:
                raise AssertionError("Cross-tenant insert passed RLS")
        # Target/stop plans cannot be forged across workspaces.
        with trade.transaction():
            trade.execute("SELECT set_config('saas.workspace_id',%s,true)",(a["workspaceId"],))
            trade.execute("SELECT set_config('saas.user_id',%s,true)",(a["userId"],))
            try:
                with trade.transaction():
                    trade.execute("""INSERT INTO saas_journal_plan_revisions
                        (workspace_id,author_user_id,idempotency_key,request_hash,
                         ticker,target_price,price_currency,rationale)
                        VALUES (%s,%s,%s,%s,'TSLA',12,'USD','forged')""",
                        (b["workspaceId"],b["userId"],str(uuid4()),"a"*64))
            except psycopg.errors.InsufficientPrivilege:
                pass
            else:
                raise AssertionError("Cross-tenant plan revision bypassed RLS")

        # No mutation permission even for a row inside one's own workspace.
        with trade.transaction():
            trade.execute("SELECT set_config('saas.workspace_id',%s,true)", (a["workspaceId"],))
            for statement in ("UPDATE saas_trade_events SET rationale='rewrite'",
                              "DELETE FROM saas_trade_events",
                              "UPDATE saas_journal_plan_revisions SET rationale='rewrite'",
                              "DELETE FROM saas_journal_plan_revisions"):
                try:
                    with trade.transaction():
                        trade.execute(statement)
                except psycopg.errors.InsufficientPrivilege:
                    pass
                else:
                    raise AssertionError("Append-only immutable event modified")
        trade.execute("RESET ROLE")
        trade.commit()
        # Membership revocation also applies immediately to financial routes.
        with identity.transaction():
            identity.execute("""UPDATE saas_workspace_memberships SET status='REVOKED'
                                WHERE workspace_id=%s AND user_id=%s""",
                             (b["workspaceId"], b["userId"]))
        trade.execute("SET ROLE saas_trade_runtime")
        trade.commit()
        try:
            list_trades(identity, trade, b_sub)
        except TradeNotFound:
            pass
        else:
            raise AssertionError("Revoked workspace user retained financial access")
        # P1 signed request nonce must be atomic and reject cross-replica replay.
        nonce = str(uuid4())
        consume_signed_request(identity,"/internal/v1/resolve",a_sub,nonce)
        try:
            consume_signed_request(identity,"/internal/v1/resolve",a_sub,nonce)
        except RequestRejected:
            pass
        else:
            raise AssertionError("Signed request nonce reused")
        # Account deletion is an explicit consented operation and preserves B.
        trade.execute("RESET ROLE")
        trade.commit()
        assert delete_account(identity,a_sub,"DELETE_MY_ACCOUNT") == {"deleted":True}
        assert resolve(identity,a_sub) is None
        with identity.transaction():
            assert identity.execute(
                "SELECT count(*) FROM saas_trade_events WHERE workspace_id=%s",
                (a["workspaceId"],)).fetchone()[0] == 0
            assert identity.execute(
                "SELECT count(*) FROM saas_trade_events WHERE workspace_id=%s",
                (b["workspaceId"],)).fetchone()[0] == 1
    print("S2 ISOLATION PASS: A/B RLS, role privilege, immutability, dedupe, void, revocation")


if __name__ == "__main__":
    main()
