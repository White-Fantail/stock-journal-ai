"""Refuse personal legacy brokerage data in the CURRENT tracked source tree.

This guard cannot scan unreachable Git objects, old branches, PR diffs, forks,
Actions artifacts or remote caches: these need separate history remediation.
"""
from __future__ import annotations

import subprocess
import sys

BANNED_PREFIXES = ("stocks/", "portfolio/", "alerts/", "reports/", "data/")
BANNED_FILES = {
    "config.yaml",
    "db/migrations/001_legacy_baseline.sql",
    ".github/workflows/daily.yml",
    "services/legacy_import/import_legacy.py",
}
BANNED_EXTENSIONS = (".csv", ".xlsx", ".xls", ".pdf", ".pem", ".p12", ".pfx")
BANNED_EXACT = {
    "tiger_openapi_config.properties",
    "tiger_openapi_token.properties",
}


def main() -> int:
    try:
        paths = subprocess.check_output(
            ["git", "ls-files", "-z"], stderr=subprocess.DEVNULL
        ).decode("utf-8").split("\0")
    except (OSError, subprocess.CalledProcessError, UnicodeDecodeError):
        print("PRIVACY_CHECK_FAILED: git index not available", file=sys.stderr)
        return 2
    violations = [
        p for p in paths if p and (
            p.startswith(BANNED_PREFIXES)
            or p in BANNED_FILES
            or p.lower().endswith(BANNED_EXTENSIONS)
            or p.rsplit("/", 1)[-1] in BANNED_EXACT
        )
    ]
    if violations:
        print("PRIVACY_CHECK_FAILED: unexpected tracked private/legacy paths:")
        for path in violations:
            print(f"  {path}")
        return 1
    print("PRIVACY_CHECK_OK: current tracked source paths only; public Git history NOT scanned")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
