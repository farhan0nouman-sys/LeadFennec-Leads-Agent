#!/bin/sh
# Runs once, when the PostgreSQL data volume is first initialized (docker-entrypoint-initdb.d).
# Creates the isolated test database "<POSTGRES_DB>_test" used by TEST_DATABASE_URL.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOSQL
CREATE DATABASE "${POSTGRES_DB}_test" OWNER "${POSTGRES_USER}";
EOSQL
