FROM python:3.12-slim
WORKDIR /srv
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY temporary /srv/temporary
RUN pip install --no-cache-dir -r /srv/temporary/tiger_personal/requirements.txt
CMD ["python","-m","temporary.tiger_personal.refresh_worker"]
