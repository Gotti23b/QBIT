-- QBIT device command queue: ephemeral history and realtime delivery.
-- Commands are retained for 24 hours after reaching a terminal state.
-- Stale pending/running commands are finalized by the hourly cleanup job.

create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to postgres;

create or replace function private.broadcast_qbit_device_command()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'id', new.id,
      'device_id', new.device_id,
      'command', new.command,
      'payload', new.payload,
      'status', new.status,
      'created_at', new.created_at,
      'expires_at', new.expires_at
    ),
    'qbit_command',
    'device:' || new.device_id::text,
    true
  );
  return new;
end;
$$;

revoke all on function private.broadcast_qbit_device_command() from public, anon, authenticated;

drop trigger if exists qbit_device_commands_broadcast_insert on public.qbit_device_commands;
create trigger qbit_device_commands_broadcast_insert
after insert on public.qbit_device_commands
for each row
execute function private.broadcast_qbit_device_command();

create or replace function private.cleanup_qbit_device_commands()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.qbit_device_commands
  set
    status = 'expired',
    completed_at = coalesce(completed_at, now()),
    error_message = coalesce(error_message, 'El comando venció antes de ejecutarse.')
  where status = 'pending'
    and expires_at <= now();

  update public.qbit_device_commands
  set
    status = 'failed',
    completed_at = coalesce(completed_at, now()),
    error_message = coalesce(error_message, 'La ejecución no devolvió resultado a tiempo.')
  where status = 'running'
    and started_at <= now() - interval '15 minutes';

  delete from public.qbit_device_commands
  where status in ('completed', 'failed', 'cancelled', 'expired')
    and coalesce(completed_at, expires_at, created_at) < now() - interval '24 hours';
end;
$$;

revoke all on function private.cleanup_qbit_device_commands() from public, anon, authenticated;

select cron.unschedule(jobid)
from cron.job
where jobname = 'qbit-device-command-cleanup';

select cron.schedule(
  'qbit-device-command-cleanup',
  '0 * * * *',
  'select private.cleanup_qbit_device_commands();'
);
