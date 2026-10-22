#!/usr/bin/env bash
set -euo pipefail
# This script deliberately clears tables. It may run only in ephemeral GitHub CI.
[[ "${CI:-}" == true && "${GITHUB_ACTIONS:-}" == true ]] || { echo 'Restore drill requires disposable GitHub CI'; exit 1; }
mgt_container="$(docker ps --filter 'name=supabase_db_' --format '{{.ID}}' | head -n 1)"
test -n "$mgt_container"
[[ "$(docker inspect --format '{{.Name}}' "$mgt_container")" == /supabase_db_* ]] || exit 1
mgt_drill_dir="$(mktemp -d)"
trap 'rm -rf "$mgt_drill_dir"' EXIT
chmod 700 "$mgt_drill_dir"
mgt_psql() { docker exec -i "$mgt_container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

mgt_psql -q < tests/database/restore-fixtures.sql
mgt_psql -Atq < tests/database/restore-manifest.sql > "$mgt_drill_dir/before.txt"
age-keygen -o "$mgt_drill_dir/identity" >/dev/null 2>&1
mgt_recipient="$(age-keygen -y "$mgt_drill_dir/identity")"
docker exec "$mgt_container" pg_dump -U postgres -d postgres --format=custom --data-only --schema=public --schema=auth |
  age --recipient "$mgt_recipient" > "$mgt_drill_dir/fixture-data.dump.age"
test -s "$mgt_drill_dir/fixture-data.dump.age"

mgt_psql -q <<'SQL'
do $$ declare tables text; begin
 select string_agg(format('%I.%I',schemaname,tablename),',') into tables
 from pg_tables where schemaname in ('public','auth');
 execute 'truncate '||tables||' restart identity cascade';
 if exists(select 1 from public.organizations) then raise exception 'Drill database was not cleared'; end if;
end $$;
SQL
age --decrypt --identity "$mgt_drill_dir/identity" "$mgt_drill_dir/fixture-data.dump.age" |
  docker exec -i "$mgt_container" pg_restore -U postgres -d postgres --data-only --disable-triggers --single-transaction --exit-on-error
mgt_psql -Atq < tests/database/restore-manifest.sql > "$mgt_drill_dir/after.txt"
diff -u "$mgt_drill_dir/before.txt" "$mgt_drill_dir/after.txt"
mgt_psql -q < tests/database/restore-verify.sql
echo 'PASS encrypted fixture restore: every public/auth row checksum, scoped access, stock, payments, refund retry, and balanced journals'
