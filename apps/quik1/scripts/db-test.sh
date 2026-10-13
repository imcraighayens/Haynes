#!/usr/bin/env bash
# Applies the migrations to a throwaway Postgres and runs supabase/tests/*.test.sql.
# Uses $DATABASE_URL if set (CI service container), else starts a local cluster.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -z "${DATABASE_URL:-}" ]]; then
  PGBIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)
  DIR=$(mktemp -d)
  # initdb refuses to run as root; use the postgres OS user when we are root.
  AS=(); if [[ $(id -u) -eq 0 ]]; then chown postgres "$DIR"; AS=(runuser -u postgres --); fi
  "${AS[@]}" "$PGBIN/initdb" -D "$DIR" -U postgres -A trust >/dev/null
  "${AS[@]}" "$PGBIN/pg_ctl" -D "$DIR" -o "-p 54329 -k $DIR" -l "$DIR/log" start >/dev/null
  trap '"${AS[@]}" "$PGBIN/pg_ctl" -D "$DIR" stop -m immediate >/dev/null; rm -rf "$DIR"' EXIT
  DATABASE_URL="postgresql://postgres@localhost:54329/postgres"
  until psql "$DATABASE_URL" -c 'select 1' >/dev/null 2>&1; do sleep 0.2; done
fi
run() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -X -f "$1"; }
run supabase/tests/supabase-stub.sql
for f in supabase/migrations/*.sql; do echo "migrate $(basename "$f")"; run "$f"; done
fail=0
for t in supabase/tests/*.test.sql; do
  if run "$t"; then echo "PASS $(basename "$t")"; else echo "FAIL $(basename "$t")"; fail=1; fi
done
exit $fail
