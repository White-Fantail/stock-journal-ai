"""Synthetic cursor and replay checks for Tiger order history."""
import sys
import unittest
from types import SimpleNamespace as NS
from unittest.mock import patch

from temporary.tiger_personal.history_sync import _pages


def order(oid,filled=2):
    return NS(id=oid,account="12345678",action="BUY",status="FILLED",
              filled=filled,filled_scale=0,avg_fill_price=20,commission=1,
              commission_currency=None,order_time=1764547200000,
              contract=NS(symbol="TSLA",currency="USD"))


class CursorTests(unittest.TestCase):
    def run_pages(self,client):
        consts=NS(SecurityType=NS(STK="STK"))
        with patch.dict(sys.modules,{"tigeropen.common.consts":consts}):
            return _pages(client,"12345678",1764547200000,1767139200000)

    def test_first_request_is_cursor_mode_and_final_page_acknowledged(self):
        class Client:
            def __init__(self): self.calls=[]
            def get_orders(self,**kwargs):
                self.calls.append(kwargs)
                return (NS(result=[order(111)],next_page_token="next") if len(self.calls)==1
                        else NS(result=[order(222)],next_page_token=None))
        client=Client()
        rows,complete=self.run_pages(client)
        self.assertTrue(complete)
        self.assertEqual([x["id"] for x in rows],["111","222"])
        self.assertEqual([x["page_token"] for x in client.calls],["","next"])

    def test_conflicting_duplicate_order_version_not_silently_overwritten(self):
        class Client:
            def __init__(self):self.n=0
            def get_orders(self,**kwargs):
                self.n+=1
                return NS(result=[order(111,2 if self.n==1 else 3)],
                          next_page_token="next" if self.n==1 else None)
        with self.assertRaisesRegex(ValueError,"CONFLICTING_ORDER_PAGES"):
            self.run_pages(Client())

    def test_legacy_full_page_without_cursor_marks_partial(self):
        class Client:
            def get_orders(self,**kwargs):return [order(i) for i in range(1,101)]
        rows,complete=self.run_pages(Client())
        self.assertEqual(len(rows),100)
        self.assertFalse(complete)


if __name__=="__main__":
    unittest.main()
