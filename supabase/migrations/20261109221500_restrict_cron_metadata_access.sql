-- Keep pg_cron metadata private to the database owner.
revoke all on schema cron from public, anon, authenticated, service_role;
revoke all on all tables in schema cron from public, anon, authenticated, service_role;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;
