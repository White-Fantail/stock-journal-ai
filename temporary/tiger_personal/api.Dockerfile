FROM python:3.12-slim
WORKDIR /srv
COPY services/saas_api/requirements.txt /tmp/saas-requirements.txt
RUN pip install --no-cache-dir -r /tmp/saas-requirements.txt
COPY services/saas_api/ /srv/services/saas_api/
COPY services/broker_connectors/ /srv/services/broker_connectors/
COPY services/tiger_sync/ /srv/services/tiger_sync/
COPY db/saas/migrations/ /srv/db/saas/migrations/
COPY temporary/ /srv/temporary/
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
CMD ["python","-m","services.saas_api.server"]
