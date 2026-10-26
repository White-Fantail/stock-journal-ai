FROM python:3.12-slim
WORKDIR /srv
COPY services/saas_api/requirements.txt /tmp/saas-requirements.txt
RUN pip install --no-cache-dir -r /tmp/saas-requirements.txt
COPY services/saas_api/ /srv/services/saas_api/
# Shared import roots required by the reconciliation, dispatch and Tiger adapters.
# Omitting these causes production import-time ModuleNotFoundError despite CI success.
COPY services/broker_connectors/ /srv/services/broker_connectors/
COPY services/tiger_sync/ /srv/services/tiger_sync/
# Operator-only schema tool reads immutable migration SQL files.
# The normal API startup never runs migrations automatically.
COPY db/saas/migrations/ /srv/db/saas/migrations/
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
CMD ["python","-m","services.saas_api.server"]
