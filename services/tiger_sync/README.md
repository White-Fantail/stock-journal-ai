# Tiger offline normalization helpers

`services/tiger_sync/` contains reusable bounded **read-only** collector and normalization code, not a customer OAuth service, trade execution engine or production ledger.

- `collector.py`: finite order/transaction windows, pagination and retry/partial handling.
- `normalization.py`: Decimal, currencies, source identifiers and timestamp-confidence normalization.
- `adapters.py`: offline/synthetic input adapters; `shared.py`: common read helpers.

The active neutral provider boundary is `services/broker_connectors/contracts.py` and `tiger.py`. The separate owner-only RSA bridge is `temporary/tiger_personal/`. Neither provider observations nor these normalizers certify a complete financial ledger.

Consult [Broker contracts](../../docs/saas/BROKER-ADAPTERS-V1.md) and [Data model](../../docs/DATA-MODEL.md). Do not add trading methods, private portfolio import fixtures or price-triggered tasks.
