"""Synthetic-only source identity/tenant isolation for owner Tiger observation notes."""
import os
import unittest
from contextlib import nullcontext
from unittest.mock import patch
from uuid import uuid4

from services.saas_api.journal_observation_links import (
    normalize_observation_note, _lookup, create_observation_note,
)
from services.saas_api.trades import TradeInputError, TradeNotFound

WID=str(uuid4())
AID=str(uuid4())
REF="a"*64
OWNER="1234567890"


def sample(**extra):
    return {"idempotencyKey":str(uuid4()),"ticker":"TSLA",
            "sourceRef":REF,"observationKind":"ORDER","page":0,
            "content":"Reason for entry and exit decision",**extra}


class Broker:
    def __init__(self):
        self.queries=[]
    def transaction(self):
        return nullcontext()
    def execute(self,sql,args=()):
        self.queries.append((sql,args))
        class Result:
            def fetchall(self):return [(AID,)]
        return Result()


class ObservationNoteTests(unittest.TestCase):
    def test_payload_does_not_allow_any_tenant_provider_or_verified_forgery(self):
        base=sample()
        self.assertEqual(normalize_observation_note(base)["ticker"],"TSLA")
        attempts=[{"workspaceId":WID},{"accountId":AID},{"authorUserId":WID},
                  {"verified":True},{"isBrokerOrder":True},{"reviewVersion":1},
                  {"observationKind":"VERIFIED"},{"ticker":"tsla"},
                  {"sourceRef":"g"*64},{"sourceRef":"a"*63},
                  {"page":21},{"page":True},{"page":"0"},
                  {"content":"  "},{"content":"x"*6001},
                  {"idempotencyKey":"no-uuid"},
                  {"observationKind":"FILL","page":1}]
        for attack in attempts:
            with self.subTest(attack=attack),self.assertRaises(TradeInputError):
                normalize_observation_note({**base,**attack})

    def test_actual_source_must_be_in_owner_broker_evidence(self):
        broker=Broker()
        with patch("services.saas_api.journal_observation_links.owner_only"),\
             patch("services.saas_api.journal_observation_links._scope",return_value=WID),\
             patch("services.saas_api.journal_observation_links.load_orders",
                   return_value={"orders":[{"sourceRef":REF,"symbol":"TSLA"}]}) as load:
            self.assertEqual(_lookup(None,broker,OWNER,sample(),WID),AID)
            self.assertEqual(load.call_args.kwargs["page"],0)
            with self.assertRaises(TradeNotFound):
                _lookup(None,broker,OWNER,sample(sourceRef="b"*64),WID)
            with self.assertRaises(TradeNotFound):
                _lookup(None,broker,OWNER,sample(ticker="AAPL"),WID)
            with self.assertRaises(TradeNotFound):
                _lookup(None,broker,OWNER,sample(),str(uuid4()))

    def test_fill_reference_never_interpreted_as_order_and_remains_unverified(self):
        broker=Broker()
        with patch("services.saas_api.journal_observation_links.owner_only"),\
             patch("services.saas_api.journal_observation_links._scope",return_value=WID),\
             patch("services.saas_api.journal_observation_links.load_orders",
                   return_value={"orders":[{"sourceRef":REF,"symbol":"TSLA"}]}),\
             patch("services.saas_api.journal_observation_links.load_probes",
                   return_value={"fillObservations":[]}) as fills:
            with self.assertRaises(TradeNotFound):
                _lookup(None,broker,OWNER,sample(observationKind="FILL"),WID)
            self.assertTrue(fills.called)

    def test_non_owner_fails_before_journal_write(self):
        with patch("services.saas_api.journal_observation_links._confirmed_scope",
                   return_value={"workspaceId":WID,"userId":str(uuid4())}),\
             patch("services.saas_api.journal_observation_links._lookup",
                   side_effect=TradeNotFound("UNKNOWN_SOURCE")):
            with self.assertRaises(TradeNotFound):
                create_observation_note(None,None,None,OWNER,sample())


if __name__=="__main__":
    unittest.main()
