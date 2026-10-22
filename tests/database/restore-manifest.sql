-- Stable content digests include every business and authentication table.
create temp table restore_manifest(name text, rows bigint, digest text);
do $$ declare t record; n bigint; d text; begin
 for t in select schemaname,tablename from pg_tables where schemaname in ('public','auth') order by 1,2 loop
  execute format('select count(*),md5(coalesce(string_agg(h,'''' order by h),'''')) from (select md5(to_jsonb(r)::text) h from %I.%I r) x',t.schemaname,t.tablename) into n,d;
  insert into restore_manifest values(t.schemaname||'.'||t.tablename,n,d);
 end loop;
end $$;
select name||'|'||rows||'|'||digest from restore_manifest order by name;
