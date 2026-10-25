#!/usr/bin/env bash
# Production-build anonymous access regression. No secrets; no deployment.
set -euo pipefail
export AUTH_SECRET=
export AUTH_GOOGLE_ID=
export AUTH_GOOGLE_SECRET=
export AUTH_URL=
export SAAS_INTERNAL_API_URL=
export SAAS_INTERNAL_SECRET=
PORT=3217
LOG="$(mktemp)"
npm run start -- -p "$PORT" >"$LOG" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true; rm -f "$LOG"' EXIT
READY=0
for _ in $(seq 1 35); do
  if curl --max-time 1 -fsS "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
if [[ "$READY" -ne 1 ]]; then echo "Smoke test: server did not become ready" >&2; exit 1; fi

status() { curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$1"; }
[[ "$(status /api/private/status)" == 401 ]] || { echo "Private API exposed" >&2; exit 1; }
[[ "$(status /api/private/tiger/status)" == 401 ]] || { echo "Tiger private API exposed" >&2; exit 1; }
[[ "$(status /private/tiger)" == 307 ]] || { echo "Tiger connection status page not protected" >&2; exit 1; }
[[ "$(status /api/auth/providers)" == 503 ]] || { echo "Unconfigured auth provider exposed" >&2; exit 1; }
[[ "$(status /private)" == 307 ]] || { echo "Private page not redirected" >&2; exit 1; }
[[ "$(status /login)" == 200 ]] || { echo "Public login status page missing" >&2; exit 1; }
[[ "$(status /)" == 200 ]] || { echo "Public shell unavailable" >&2; exit 1; }
private_headers="$(curl -s -D - -o /dev/null "http://127.0.0.1:$PORT/api/private/status" | tr -d '\r')"
grep -qi 'cache-control:.*no-store' <<<"$private_headers" || {
  echo "Private API caching not disabled" >&2; exit 1;
}
grep -qi 'x-robots-tag:.*noindex' <<<"$private_headers" || {
  echo "Private API indexing not disabled" >&2; exit 1;
}
private_body="$(curl -s "http://127.0.0.1:$PORT/api/private/status")"
[[ "$private_body" == '{"error":"UNAUTHORIZED"}' ]] || {
  echo "Private endpoint leaked data" >&2; exit 1;
}
echo "WEB GOOGLE-SAAS ANONYMOUS SMOKE PASS: 401 private API; 307 private page; 503 unconfigured auth; no-store"
