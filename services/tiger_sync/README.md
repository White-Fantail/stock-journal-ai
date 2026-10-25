# Tiger offline normalization utilities
This package retains reusable **synthetic/offline** order, transaction and position collection logic for the first SaaS broker adapter. It is **not** a live account integration and does not provide auth, trade execution or production database access.

- `collector.py`: bounded, read-only pagination, time windows, retry/partial failure.
- `normalization.py`: source-to-Decimal and timestamp normalization with explicit uncertainty.
- `adapters.py`: synthetic fixture input.
- `shared.py`: helper contracts.

The active broker boundary is `services/broker_connectors/tiger.py`. Never reintroduce personal archive imports, single-user shadow tables or shared token persistence. See [Broker adapters](../../docs/saas/BROKER-ADAPTERS-V1.md) and [Roadmap](../../docs/ROADMAP.md).
