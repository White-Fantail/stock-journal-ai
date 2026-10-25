import unittest
from services.saas_api.sync_dispatcher import DispatchRefused, bounded_cycle, tick

class DispatcherGateTests(unittest.TestCase):
    def test_disabled(self):
        with self.assertRaisesRegex(DispatchRefused, "DISPATCH_DISABLED"):
            tick(None, None, None, lambda *args: None)
        with self.assertRaisesRegex(DispatchRefused, "DISPATCH_DISABLED"):
            tick(None, None, None, None, enabled=True)

    def test_tick_bound(self):
        for number in (0, 9, -1, 1.5, True):
            with self.subTest(number=number):
                with self.assertRaisesRegex(DispatchRefused,"INVALID_TICK_LIMIT"):
                    bounded_cycle(None,None,None,None,max_ticks=number)
