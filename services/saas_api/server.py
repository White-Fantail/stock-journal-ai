"""HMAC-authenticated internal SaaS identity API for Vercel -> Railway.

No public customer data endpoint or broker trading API. Never logs bodies.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from services.saas_api.identity import provision, resolve
from services.saas_api.trades import TradeInputError, TradeConflict, TradeNotFound, list_trades, create_trade
from services.saas_api.indicators import list_rules, save_rule, list_records, save_record
from services.saas_api.journal import list_notes, create_note, export_journal
from services.saas_api.plan_checkins import context as checkin_context, create_checkin
from services.saas_api.monthly_process import monthly_process
from services.saas_api.weekly_process import weekly_process
from services.saas_api.risk_factors import list_risk_factors, save_risk_factors
from services.saas_api.investor_principles import get_principles, save_principles
from services.saas_api.action_followups import list_followups, create_followup
from services.saas_api.journal_broker_links import create_broker_note
from services.saas_api.journal_observation_links import create_observation_note
from services.saas_api.journal_plans import list_plans,create_plan
from services.saas_api.ai_quota import claim_ai
from services.saas_api.request_security import valid_nonce, consume_signed_request, consume_mcp_grant_nonce, RequestRejected
from services.saas_api.account import delete_account
from services.saas_api.trade_detail import trade_detail
from services.saas_api.sync_status import sync_status
from services.saas_api.reconciliation_store import review_status
from services.saas_api.ledger_read import private_ledger
# Removable pilot hook. The standard production image intentionally omits it.
try:
    from temporary.tiger_personal.api import PilotError, import_pilot, view_pilot
    from temporary.tiger_personal.history import import_orders
    from temporary.tiger_personal.fill_probe import import_probes
    from temporary.tiger_personal.market_quotes import import_quotes
    from temporary.tiger_personal.sync_health import import_health,view_health
    from temporary.tiger_personal.diagnostics import view_diagnostics
except ModuleNotFoundError as exc:
    if exc.name not in ("temporary", "temporary.tiger_personal", "temporary.tiger_personal.api"):
        raise
    class PilotError(Exception):
        def __init__(self, code="DISABLED"):
            super().__init__(code)
            self.code = code
    def import_pilot(*args):
        raise PilotError()
    def view_pilot(*args):
        raise PilotError()
    def import_orders(*args):
        raise PilotError()
    def import_probes(*args):
        raise PilotError()
    def import_quotes(*args):
        raise PilotError()
    def import_health(*args):
        raise PilotError()
    def view_health(*args):
        raise PilotError()
    def view_diagnostics(*args):
        raise PilotError()

from services.saas_api.tiger_oauth import (TigerError, begin as tiger_begin, finish as tiger_finish,
    list_connections as tiger_list, bind_account as tiger_bind, read_account as tiger_read,
    disconnect as tiger_disconnect)

_ALLOWED = {"/internal/v1/provision", "/internal/v1/resolve", "/internal/v1/mcp/consume",
            "/internal/v1/trades/list", "/internal/v1/trades/create",
            "/internal/v1/journal/list", "/internal/v1/journal/create",
            "/internal/v1/journal/export", "/internal/v1/journal/monthly-process", "/internal/v1/journal/weekly-process", "/internal/v1/risk-factors/list", "/internal/v1/risk-factors/create",
            "/internal/v1/indicators/rules", "/internal/v1/indicators/rule/save",
            "/internal/v1/indicators/records", "/internal/v1/indicators/record/save",
            "/internal/v1/principles/get", "/internal/v1/principles/save",
            "/internal/v1/review/actions", "/internal/v1/review/action/resolve", "/internal/v1/journal/checkin/context", "/internal/v1/journal/checkin/create", "/internal/v1/journal/broker-note/create", "/internal/v1/journal/observation-note/create", "/internal/v1/journal/plans",
            "/internal/v1/journal/plan/create", "/internal/v1/ai/claim", "/internal/v1/account/delete", "/internal/v1/trades/detail",
            "/internal/v1/tiger/status", "/internal/v1/tiger/start",
            "/internal/v1/tiger/callback", "/internal/v1/tiger/bind",
            "/internal/v1/tiger/read", "/internal/v1/tiger/disconnect",
            "/internal/v1/tiger/sync-status", "/internal/v1/tiger/review-status",
            "/internal/v1/tiger/ledger-read",
            "/internal/v1/tiger/personal-import", "/internal/v1/tiger/personal-view",
            "/internal/v1/tiger/personal-orders-import",
            "/internal/v1/tiger/personal-transactions-import",
            "/internal/v1/tiger/personal-quotes-import",
            "/internal/v1/tiger/personal-health-import",
            "/internal/v1/tiger/personal-health-view",
            "/internal/v1/tiger/personal-diagnostics"}
_MAX_BYTES = 4096

def authorized(method: str, path: str, raw_body: bytes, headers, secret: str, now: int | None = None) -> bool:
    if not secret or len(secret) < 32:
        return False
    stamp = headers.get("X-Saas-Timestamp", "")
    sig = headers.get("X-Saas-Signature", "")
    nonce = headers.get("X-Saas-Nonce", "")
    if not valid_nonce(nonce):
        return False
    if not stamp.isdecimal() or len(stamp) > 12 or len(sig) != 64:
        return False
    moment = int(time.time()) if now is None else now
    if abs(moment-int(stamp)) > 30:
        return False
    content = f"{stamp}\n{nonce}\n{method}\n{path}\n".encode() + raw_body
    digest = hmac.new(secret.encode(),content,hashlib.sha256).hexdigest()
    return hmac.compare_digest(digest,sig)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # Do not print URLs, bodies or identity values.
        pass

    def reply(self, status: int, body: dict):
        encoded = json.dumps(body,separators=(",",":")).encode()
        self.send_response(status)
        self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Content-Length",str(len(encoded)))
        self.send_header("Cache-Control","private, no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        if self.path == "/healthz":
            self.reply(200, {"status":"UP"}) # no DB or account detail
        else:
            self.reply(404, {"error":"NOT_FOUND"})

    def do_POST(self):
        path = urlparse(self.path).path
        if self.path not in _ALLOWED or path != self.path:
            return self.reply(404,{"error":"NOT_FOUND"})
        try:
            n=int(self.headers.get("Content-Length","-1"))
            # Korean rationale can be up to 3,000 characters (multibyte UTF-8).
            # Retain tighter request bounds on identity and read-only routes.
            max_body = (24576 if path in ("/internal/v1/tiger/personal-import",
                           "/internal/v1/tiger/personal-orders-import",
                             "/internal/v1/tiger/personal-transactions-import",
                             "/internal/v1/tiger/personal-quotes-import",
                             "/internal/v1/tiger/personal-health-import")
                        else 32768 if path in ("/internal/v1/journal/broker-note/create",
                                                  "/internal/v1/journal/observation-note/create")
                        else 16384 if path in ("/internal/v1/trades/create",
                                                "/internal/v1/journal/create",
                                                "/internal/v1/journal/plan/create",
                                                "/internal/v1/journal/checkin/create", "/internal/v1/risk-factors/create",
                                                "/internal/v1/principles/save", "/internal/v1/indicators/rule/save",
                                                "/internal/v1/indicators/record/save", "/internal/v1/review/action/resolve")
                        else _MAX_BYTES)
            if n < 0 or n > max_body:
                return self.reply(413,{"error":"INVALID_BODY"})
            body=self.rfile.read(n)
            if path in ("/internal/v1/tiger/personal-import",
                        "/internal/v1/tiger/personal-orders-import",
                         "/internal/v1/tiger/personal-transactions-import",
                         "/internal/v1/tiger/personal-quotes-import",
                             "/internal/v1/tiger/personal-health-import") and os.environ.get("POSITIONARY_PERSONAL_TIGER_ENABLED") != "1":
                return self.reply(404,{"error":"NOT_FOUND"})
            key = (os.environ.get("POSITIONARY_PERSONAL_BRIDGE_SECRET","")
                   if path in ("/internal/v1/tiger/personal-import",
                               "/internal/v1/tiger/personal-orders-import",
                             "/internal/v1/tiger/personal-transactions-import",
                             "/internal/v1/tiger/personal-quotes-import",
                             "/internal/v1/tiger/personal-health-import")
                   else os.environ.get("SAAS_INTERNAL_SECRET",""))
            if not authorized("POST",path,body,self.headers,key):
                return self.reply(401,{"error":"UNAUTHORIZED"})
            data=json.loads(body)
            if not isinstance(data,dict):
                return self.reply(400,{"error":"INVALID_BODY"})
            dsn=os.environ.get("SAAS_DATABASE_URL")
            if not dsn:
                return self.reply(503,{"error":"NOT_CONFIGURED"})
            import psycopg  # optional runtime dependency; zero packages for security unit tests
            if path == "/internal/v1/mcp/consume":
                if set(data) != {"subject", "tokenNonce", "expiresAt"}:
                    return self.reply(400,{"error":"UNEXPECTED_FIELDS"})
                with psycopg.connect(dsn,connect_timeout=5) as identity_conn:
                    consume_signed_request(identity_conn,path,data.get("subject"),self.headers["X-Saas-Nonce"])
                    if not resolve(identity_conn,data.get("subject")):
                        return self.reply(403,{"error":"MEMBERSHIP_REVOKED"})
                    consume_mcp_grant_nonce(identity_conn,data.get("tokenNonce"),data.get("expiresAt"))
                return self.reply(200,{"consumed":True})
            if path.startswith("/internal/v1/tiger/"):
                # Broker operations require a separate limited RLS login.
                # Neither client-provided workspace IDs nor provider URLs are accepted.
                broker_dsn = os.environ.get("SAAS_BROKER_DATABASE_URL")
                if not broker_dsn or broker_dsn == dsn:
                    return self.reply(503,{"error":"BROKER_DB_ROLE_NOT_CONFIGURED"})
                permitted = {
                    "/internal/v1/tiger/status": {"subject"},
                    "/internal/v1/tiger/sync-status": {"subject"},
                    "/internal/v1/tiger/review-status": {"subject"},
                    "/internal/v1/tiger/ledger-read": {"subject"},
                    "/internal/v1/tiger/start": {"subject"},
                    "/internal/v1/tiger/callback": {"subject","state","code","scope"},
                    "/internal/v1/tiger/bind": {"subject","connectionId","accountNumber"},
                    "/internal/v1/tiger/read": {"subject","accountId"},
                    "/internal/v1/tiger/disconnect": {"subject","connectionId"},
                    "/internal/v1/tiger/personal-import": {"subject","account","assets","positions"},
                    "/internal/v1/tiger/personal-view": {"subject"},
                    "/internal/v1/tiger/personal-orders-import": {"subject","account","from","to","part","parts","complete","orders"},
                     "/internal/v1/tiger/personal-transactions-import": {"subject","account","from","to","probes"},
                     "/internal/v1/tiger/personal-quotes-import": {"subject","account","quotes"},
                     "/internal/v1/tiger/personal-health-import": {"subject","account","runId","assets","orders","fills"},
                     "/internal/v1/tiger/personal-health-view": {"subject"},
                     "/internal/v1/tiger/personal-diagnostics": {"subject"},
                }
                if path == "/internal/v1/tiger/personal-view":
                    # Signed gateway chooses a bounded page; no tenant/account locator.
                    page=data.get("page","0")
                    if (set(data)!={"subject","page"} or not isinstance(page,str)
                            or not page.isdecimal() or len(page)>2 or int(page)>20):
                        return self.reply(400,{"error":"INVALID_PAGE"})
                elif set(data) != permitted[path]:
                    return self.reply(400,{"error":"UNEXPECTED_FIELDS"})
                with psycopg.connect(dsn,connect_timeout=5) as identity_conn:
                    consume_signed_request(identity_conn,path,data.get("subject"),self.headers["X-Saas-Nonce"])
                    with psycopg.connect(broker_dsn,connect_timeout=5) as broker_conn:
                        if path.endswith("/personal-health-import"):
                            out=import_health(identity_conn,broker_conn,data)
                        elif path.endswith("/personal-health-view"):
                            out=view_health(identity_conn,broker_conn,data["subject"])
                        elif path.endswith("/personal-diagnostics"):
                            out=view_diagnostics(identity_conn,broker_conn,data["subject"])
                        elif path.endswith("/personal-quotes-import"):
                            out=import_quotes(identity_conn,broker_conn,data)
                        elif path.endswith("/personal-transactions-import"):
                            out=import_probes(identity_conn,broker_conn,data)
                        elif path.endswith("/personal-orders-import"):
                            out=import_orders(identity_conn,broker_conn,data)
                        elif path.endswith("/personal-import"):
                            out=import_pilot(identity_conn,broker_conn,data)
                        elif path.endswith("/personal-view"):
                            out=view_pilot(identity_conn,broker_conn,data["subject"],int(data["page"]))
                        elif path.endswith("/ledger-read"):
                            out=private_ledger(identity_conn,broker_conn,data["subject"])
                        elif path.endswith("/review-status"):
                            out=review_status(identity_conn,broker_conn,data["subject"])
                        elif path.endswith("/sync-status"):
                            out=sync_status(identity_conn,broker_conn,data["subject"])
                        elif path.endswith("/status"):
                            out=tiger_list(identity_conn,broker_conn,data["subject"])
                        elif path.endswith("/start"):
                            out=tiger_begin(identity_conn,broker_conn,data["subject"])
                        elif path.endswith("/callback"):
                            out=tiger_finish(identity_conn,broker_conn,data["subject"],data["state"],data["code"],data["scope"])
                        elif path.endswith("/bind"):
                            out=tiger_bind(identity_conn,broker_conn,data["subject"],data["connectionId"],data["accountNumber"])
                        elif path.endswith("/read"):
                            out=tiger_read(identity_conn,broker_conn,data["subject"],data["accountId"])
                        else:
                            out=tiger_disconnect(identity_conn,broker_conn,data["subject"],data["connectionId"])
                return self.reply(200,out)
            if path == "/internal/v1/account/delete":
                if set(data) != {"subject","confirmation"}:
                    return self.reply(400,{"error":"UNEXPECTED_FIELDS"})
                with psycopg.connect(dsn,connect_timeout=5) as identity_conn:
                    consume_signed_request(identity_conn,path,data.get("subject"),self.headers["X-Saas-Nonce"])
                    out=delete_account(identity_conn,data.get("subject"),data.get("confirmation"))
                return self.reply(200,out)
            if (path.startswith("/internal/v1/trades/") or path.startswith("/internal/v1/journal/") or
                path.startswith("/internal/v1/risk-factors/") or
                path.startswith("/internal/v1/indicators/") or
                path.startswith("/internal/v1/principles/") or
                path.startswith("/internal/v1/review/") or path == "/internal/v1/ai/claim"):
                # Financial operations ALWAYS require a separate
                # non-BYPASSRLS, SELECT/INSERT-only Postgres login role.
                scoped_dsn = os.environ.get("SAAS_TRADE_DATABASE_URL")
                if not scoped_dsn or scoped_dsn == dsn:
                    return self.reply(503,{"error":"FINANCIAL_DB_ROLE_NOT_CONFIGURED"})
                if path == "/internal/v1/ai/claim" and set(data)!={"subject","mode","consented"}:
                    return self.reply(400,{"error":"UNEXPECTED_FIELDS"})
                if path == "/internal/v1/journal/broker-note/create" and set(data)!={"subject","brokerNote"}:
                    return self.reply(400,{"error":"UNEXPECTED_FIELDS"})
                if path == "/internal/v1/journal/observation-note/create" and set(data)!={"subject","observationNote"}:
                    return self.reply(400,{"error":"UNEXPECTED_FIELDS"})
                # Deny tenant/account selection in client payload, even though
                # every request also derives membership fresh from Google subject.
                if set(data) - ({"subject","mode","consented"} if path == "/internal/v1/ai/claim" else
                                {"subject","rule"} if path == "/internal/v1/indicators/rule/save" else
                                {"subject","record"} if path == "/internal/v1/indicators/record/save" else
                                {"subject","filter"} if path == "/internal/v1/indicators/records" else
                                {"subject","tradeId"} if path == "/internal/v1/trades/detail" else
                                {"subject","month"} if path == "/internal/v1/journal/monthly-process" else
                                {"subject","week"} if path == "/internal/v1/journal/weekly-process" else
                                {"subject"} if path == "/internal/v1/risk-factors/list" else
                                {"subject"} if path == "/internal/v1/principles/get" else
                                {"subject"} if path == "/internal/v1/review/actions" else
                                {"subject","actionFollowup"} if path == "/internal/v1/review/action/resolve" else
                                {"subject","principles"} if path == "/internal/v1/principles/save" else
                                {"subject","riskFactors"} if path == "/internal/v1/risk-factors/create" else
                                {"subject","ticker"} if path == "/internal/v1/journal/checkin/context" else
                                {"subject","checkin"} if path == "/internal/v1/journal/checkin/create" else
                                {"subject","trade"} if path == "/internal/v1/trades/create" else
                                {"subject","entry"} if path == "/internal/v1/journal/create" else
                                {"subject","plan"} if path == "/internal/v1/journal/plan/create" else
                                {"subject","brokerNote"} if path == "/internal/v1/journal/broker-note/create" else
                                {"subject","observationNote"} if path == "/internal/v1/journal/observation-note/create" else
                                {"subject"}):
                    return self.reply(400,{"error":"UNEXPECTED_FIELDS"})
                with psycopg.connect(dsn,connect_timeout=5) as identity_conn:
                    consume_signed_request(identity_conn,path,data.get("subject"),self.headers["X-Saas-Nonce"])
                    with psycopg.connect(scoped_dsn,connect_timeout=5) as trade_conn:
                        if path == "/internal/v1/ai/claim":
                            out=claim_ai(identity_conn,trade_conn,data.get("subject"),
                                {"mode":data.get("mode"),"consented":data.get("consented")})
                        elif path == "/internal/v1/trades/list":
                            out=list_trades(identity_conn,trade_conn,data.get("subject"))
                        elif path == "/internal/v1/trades/create":
                            out=create_trade(identity_conn,trade_conn,data.get("subject"),data.get("trade"))
                        elif path == "/internal/v1/trades/detail":
                            out=trade_detail(identity_conn,trade_conn,data.get("subject"),data.get("tradeId"))
                        elif path == "/internal/v1/journal/list":
                            out=list_notes(identity_conn,trade_conn,data.get("subject"))
                        elif path == "/internal/v1/journal/monthly-process":
                            out=monthly_process(identity_conn,trade_conn,data.get("subject"),data.get("month"))
                        elif path == "/internal/v1/journal/weekly-process":
                            out=weekly_process(identity_conn,trade_conn,data.get("subject"),data.get("week"))
                        elif path == "/internal/v1/review/actions":
                            out=list_followups(identity_conn,trade_conn,data.get("subject"))
                        elif path == "/internal/v1/review/action/resolve":
                            out=create_followup(identity_conn,trade_conn,data.get("subject"),data.get("actionFollowup"))
                        elif path == "/internal/v1/indicators/rules":
                            out=list_rules(identity_conn,trade_conn,data.get("subject"))
                        elif path == "/internal/v1/indicators/rule/save":
                            out=save_rule(identity_conn,trade_conn,data.get("subject"),data.get("rule"))
                        elif path == "/internal/v1/indicators/records":
                            out=list_records(identity_conn,trade_conn,data.get("subject"),data.get("filter"))
                        elif path == "/internal/v1/indicators/record/save":
                            out=save_record(identity_conn,trade_conn,data.get("subject"),data.get("record"))
                        elif path == "/internal/v1/principles/get":
                            out=get_principles(identity_conn,trade_conn,data.get("subject"))
                        elif path == "/internal/v1/principles/save":
                            out=save_principles(identity_conn,trade_conn,data.get("subject"),data.get("principles"))
                        elif path == "/internal/v1/risk-factors/list":
                            out=list_risk_factors(identity_conn,trade_conn,data.get("subject"))
                        elif path == "/internal/v1/risk-factors/create":
                            out=save_risk_factors(identity_conn,trade_conn,data.get("subject"),data.get("riskFactors"))
                        elif path == "/internal/v1/journal/checkin/context":
                            out=checkin_context(identity_conn,trade_conn,data.get("subject"),data.get("ticker"))
                        elif path == "/internal/v1/journal/checkin/create":
                            out=create_checkin(identity_conn,trade_conn,data.get("subject"),data.get("checkin"))
                        elif path == "/internal/v1/journal/create":
                            out=create_note(identity_conn,trade_conn,data.get("subject"),data.get("entry"))
                        elif path == "/internal/v1/journal/broker-note/create":
                            broker_dsn=os.environ.get("SAAS_BROKER_DATABASE_URL")
                            if not broker_dsn or broker_dsn in (dsn,scoped_dsn):
                                return self.reply(503,{"error":"BROKER_DB_ROLE_NOT_CONFIGURED"})
                            with psycopg.connect(broker_dsn,connect_timeout=5) as broker_conn:
                                out=create_broker_note(identity_conn,broker_conn,trade_conn,
                                    data.get("subject"),data.get("brokerNote"))
                        elif path == "/internal/v1/journal/observation-note/create":
                            broker_dsn=os.environ.get("SAAS_BROKER_DATABASE_URL")
                            if not broker_dsn or broker_dsn in (dsn,scoped_dsn):
                                return self.reply(503,{"error":"BROKER_DB_ROLE_NOT_CONFIGURED"})
                            with psycopg.connect(broker_dsn,connect_timeout=5) as broker_conn:
                                out=create_observation_note(identity_conn,broker_conn,trade_conn,
                                    data.get("subject"),data.get("observationNote"))
                        elif path == "/internal/v1/journal/plans":
                            out=list_plans(identity_conn,trade_conn,data.get("subject"))
                        elif path == "/internal/v1/journal/plan/create":
                            out=create_plan(identity_conn,trade_conn,data.get("subject"),data.get("plan"))
                        else:
                            out=export_journal(identity_conn,trade_conn,data.get("subject"))
                return self.reply(200,out)
            with psycopg.connect(dsn,connect_timeout=5) as connection:
                consume_signed_request(connection,path,data.get("subject"),self.headers["X-Saas-Nonce"])
                if path.endswith("/provision"):
                    out=provision(connection,data)
                else:
                    out=resolve(connection,data.get("subject"))
                    if not out:
                        return self.reply(404,{"error":"ACCOUNT_NOT_FOUND"})
            return self.reply(200,out)
        except PilotError as error:
            return self.reply(403 if error.code in ("NOT_AUTHORIZED","DISABLED") else 400,{"error":error.code})
        except TigerError as error:
            code = error.code
            return self.reply(409 if code in ("STATE_EXPIRED_OR_REPLAYED","REAUTH_REQUIRED") else 503,
                              {"error":code})
        except RequestRejected:
            return self.reply(429,{"error":"REPLAY_OR_RATE_LIMIT"})
        except TradeInputError:
            return self.reply(400,{"error":"INVALID_TRADE"})
        except TradeConflict:
            return self.reply(409,{"error":"TRADE_CONFLICT"})
        except TradeNotFound:
            return self.reply(404,{"error":"MEMBERSHIP_OR_TRADE_NOT_FOUND"})
        except (ValueError, json.JSONDecodeError):
            return self.reply(400,{"error":"INVALID_REQUEST"})
        except Exception:
            # Never leak connection errors or confidential identity data.
            return self.reply(503,{"error":"SERVICE_UNAVAILABLE"})

def main():
    if not os.environ.get("SAAS_DATABASE_URL") or len(os.environ.get("SAAS_INTERNAL_SECRET","")) < 32:
        raise SystemExit("SaaS identity API requires private database and HMAC configuration")
    port=int(os.environ.get("PORT","8080"))
    ThreadingHTTPServer(("0.0.0.0",port),Handler).serve_forever()

if __name__=="__main__":
    main()
