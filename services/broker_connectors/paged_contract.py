"""Pure bounded read-only page contract; no provider SDK or credentials."""
from __future__ import annotations

from dataclasses import dataclass

from .contracts import BrokerFill, BrokerSyncRequest


MAX_PAGE_ITEMS = 100
MAX_WINDOW_PAGES = 50


@dataclass(frozen=True)
class ReadPage:
    request: BrokerSyncRequest
    fills: tuple[BrokerFill, ...]
    next_cursor: str | None
    terminal: bool

    def __post_init__(self):
        if not isinstance(self.request, BrokerSyncRequest):
            raise ValueError("BAD_REQUEST")
        if not isinstance(self.fills, tuple) or len(self.fills) > MAX_PAGE_ITEMS:
            raise ValueError("PAGE_LIMIT")
        if any(not isinstance(fill, BrokerFill) for fill in self.fills):
            raise ValueError("BAD_FILL")
        if type(self.terminal) is not bool:
            raise ValueError("BAD_TERMINAL_FLAG")
        if self.next_cursor is not None and (
            not isinstance(self.next_cursor, str) or not self.next_cursor
            or len(self.next_cursor) > 256 or any(ord(c) < 32 for c in self.next_cursor)
        ):
            raise ValueError("BAD_CURSOR")
        if self.terminal == (self.next_cursor is not None):
            raise ValueError("UNPROVEN_PAGE_TERMINATION")
        # Even a terminal page does NOT establish history coverage; the
        # provider must separately certify history/capability/permission.
