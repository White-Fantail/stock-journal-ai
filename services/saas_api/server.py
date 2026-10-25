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
from services.saas_api.journal import list_notes, create_note, export_journal
from services.saas_api.request_security import valid_nonce, consume_signed_request, RequestRejected
from services.saas_api.account import delete_account
from services.saas_api.trade_detail import trade_detail

_ALLOWED = {"/internal/v1/provision", "/internal/v1/resolve",
            "/internal/v1/trades/list", "/internal/v1/trades/create",
            "/internal/v1/journal/list", "/internal/v1/journal/create",
            "/internal/v1/journal/export", "/internal/v1/account/delete", "/internal/v1/trades/detail"}
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
            max_body = 16384 if path in ("/internal/v1/trades/create", "/internal/v1/journal/create") else _MAX_BYTES
            if n < 0 or n > max_body:
                return self.reply(413,{"error":"INVALID_BODY"})
            body=self.rfile.read(n)
            if not authorized("POST",path,body,self.headers,os.environ.get("SAAS_INTERNAL_SECRET","")):
                return self.reply(401,{"error":"UNAUTHORIZED"})
            data=json.loads(body)
            if not isinstance(data,dict):
                return self.reply(400,{"error":"INVALID_BODY"})
            dsn=os.environ.get("SAAS_DATABASE_URL")
            if not dsn:
                return self.reply(503,{"error":"NOT_CONFIGURED"})
            import psycopg  # optional runtime dependency; zero packages for security unit tests
            if path == "/internal/v1/account/delete":
                if set(data) != {"subject","confirmation"}:
                    return self.reply(400,{"error":"UNEXPECTED_FIELDS"})
                with psycopg.connect(dsn,connect_timeout=5) as identity_conn:
                    consume_signed_request(identity_conn,path,data.get("subject"),self.headers["X-Saas-Nonce"])
                    out=delete_account(identity_conn,data.get("subject"),data.get("confirmation"))
                return self.reply(200,out)
            if path.startswith("/internal/v1/trades/") or path.startswith("/internal/v1/journal/"):
                # Financial operations are fail-closed and MUST use a separate
                # non-BYPASSRLS, SELECT/INSERT-only Postgres login role.
                if os.environ.get("SAAS_S2_ENABLED") != "1":
                    return self.reply(503,{"error":"FEATURE_NOT_ENABLED"})
                scoped_dsn = os.environ.get("SAAS_TRADE_DATABASE_URL")
                if not scoped_dsn or scoped_dsn == dsn:
                    return self.reply(503,{"error":"FINANCIAL_DB_ROLE_NOT_CONFIGURED"})
                # Deny tenant/account selection in client payload, even though
                # every request also derives membership fresh from Google subject.
                if set(data) - ({"subject","tradeId"} if path == "/internal/v1/trades/detail" else
                                {"subject","trade"} if path == "/internal/v1/trades/create" else
                                {"subject","entry"} if path == "/internal/v1/journal/create" else
                                {"subject"}):
                    return self.reply(400,{"error":"UNEXPECTED_FIELDS"})
                with psycopg.connect(dsn,connect_timeout=5) as identity_conn:
                    consume_signed_request(identity_conn,path,data.get("subject"),self.headers["X-Saas-Nonce"])
                    with psycopg.connect(scoped_dsn,connect_timeout=5) as trade_conn:
                        if path == "/internal/v1/trades/list":
                            out=list_trades(identity_conn,trade_conn,data.get("subject"))
                        elif path == "/internal/v1/trades/create":
                            out=create_trade(identity_conn,trade_conn,data.get("subject"),data.get("trade"))
                        elif path == "/internal/v1/trades/detail":
                            out=trade_detail(identity_conn,trade_conn,data.get("subject"),data.get("tradeId"))
                        elif path == "/internal/v1/journal/list":
                            out=list_notes(identity_conn,trade_conn,data.get("subject"))
                        elif path == "/internal/v1/journal/create":
                            out=create_note(identity_conn,trade_conn,data.get("subject"),data.get("entry"))
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
