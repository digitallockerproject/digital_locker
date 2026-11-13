FROM python:3.13-slim-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends g++ make cmake unzip libcurl4-openssl-dev
RUN pip install --no-cache-dir --target /install awslambdaric==3.1.1 boto3==1.42.49

FROM python:3.13-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends clamav clamav-freshclam ca-certificates libcurl4 \
    && rm -rf /var/lib/apt/lists/* /var/lib/clamav/*
COPY --from=build /install /opt/python
ENV PYTHONPATH=/opt/python
WORKDIR /function
COPY scanner.py .
ENTRYPOINT ["python", "-m", "awslambdaric"]
CMD ["scanner.handler"]
