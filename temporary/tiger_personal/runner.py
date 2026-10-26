"""Disposable, single-owner Tiger OpenAPI connectivity probe.

No data is saved, no positions or money are logged, and no trading methods
are exposed. This must run outside Positionary's production API service.
"""
from __future__ import annotations
import base64
import os
import re
import sys

_ACCOUNT = re.compile(r"^[A-Za-z0-9]{5,25}$")

def configuration(env):
    """Refuse unknown/incomplete configuration without echoing credentials."""
    if env.get("POSITIONARY_PERSONAL_TIGER_ENABLED") != "1":
        raise ValueError("PILOT_DISABLED")
    tiger_id = env.get("POSITIONARY_PERSONAL_TIGER_ID", "")
    account = env.get("POSITIONARY_PERSONAL_ACCOUNT", "")
    encoded_key = env.get("POSITIONARY_PERSONAL_PRIVATE_KEY_B64", "")
    if not tiger_id or not _ACCOUNT.fullmatch(account):
        raise ValueError("PILOT_INCOMPLETE")
    try:
        private_key = base64.b64decode(encoded_key, validate=True).decode("ascii")
    except Exception as exc:
        raise ValueError("PILOT_INVALID_KEY") from exc
    # Tiger config exports DER/base64 PKCS#1 or PKCS#8 without PEM headers.
    # Accept either this canonical format or a PEM wrapping, but never URLs/paths.
    if private_key.startswith("-----BEGIN"):
        if "PRIVATE KEY-----" not in private_key or "-----END" not in private_key:
            raise ValueError("PILOT_INVALID_KEY")
        private_key = "".join(line.strip() for line in private_key.splitlines()
                              if not line.startswith("-----"))
    if not re.fullmatch(r"[A-Za-z0-9+/=]{256,8192}", private_key):
        raise ValueError("PILOT_INVALID_KEY")
    try:
        parsed = base64.b64decode(private_key, validate=True)
    except Exception as exc:
        raise ValueError("PILOT_INVALID_KEY") from exc
    if len(parsed) < 256 or parsed[:1] != bytes([0x30]):
        raise ValueError("PILOT_INVALID_KEY")
    return tiger_id, account, private_key

def read_only_snapshot(client, account):
    """Only documented query methods; never accept caller-selected methods."""
    assets = client.get_assets(account=account)
    positions = client.get_positions(account=account)
    if not isinstance(positions, (list, tuple)) or len(positions) > 200:
        raise ValueError("UNEXPECTED_POSITIONS")
    if not isinstance(assets, (list, tuple)) or not assets:
        raise ValueError("UNEXPECTED_ASSETS")
    return len(positions)

def run(env=None, factory=None):
    env = os.environ if env is None else env
    tiger_id, account, private_key = configuration(env)
    if factory is None:
        from tigeropen.tiger_open_config import TigerOpenClientConfig
        from tigeropen.trade.trade_client import TradeClient
        cfg = TigerOpenClientConfig()
        cfg.tiger_id = tiger_id
        cfg.account = account
        cfg.private_key = private_key
        cfg.license = env.get("POSITIONARY_PERSONAL_LICENSE", "TBNZ")
        cfg.timeout = 10
        cfg.retry_max_tries = 1
        client = TradeClient(cfg)
    else:
        client = factory(tiger_id, account, private_key)
    return read_only_snapshot(client, account)

def main():
    try:
        count = run()
        print("PERSONAL_TIGER_READ_OK; position_count=" + str(count))
    except Exception:
        # Upstream SDK errors may embed account IDs, key fragments or raw responses.
        print("PERSONAL_TIGER_NOT_CONNECTED")
        sys.exit(1)

if __name__ == "__main__":
    main()
