-- Kurslot: Tagesbudget pro Datenanbieter statt eines einzigen globalen Zählers.
-- Grund: Twelve Data kommt als zweite Quelle dazu (800 Abrufe/Tag, eigenes
-- Kontingent) und darf das Alpha-Vantage-Budget (25/Tag) nicht mitzählen.

alter table kurslot.api_usage rename column calls to calls_old;
alter table kurslot.api_usage add column provider text;
update kurslot.api_usage set provider = 'alphavantage' where provider is null;
alter table kurslot.api_usage alter column provider set not null;
alter table kurslot.api_usage add column calls integer not null default 0;
update kurslot.api_usage set calls = calls_old;
alter table kurslot.api_usage drop column calls_old;

alter table kurslot.api_usage drop constraint if exists api_usage_pkey;
alter table kurslot.api_usage add primary key (day, provider);

-- Ersetzt die Vorgänger aus kurslot_public_rpc_wrappers.sql / kurslot_refund.sql.
-- Die alten Signaturen (ohne p_provider) müssen weg, sonst wären Aufrufe mit
-- lauter Default-Argumenten zwischen alter und neuer Funktion mehrdeutig.
drop function if exists public.kurslot_spend(integer);
drop function if exists public.kurslot_usage();
drop function if exists public.kurslot_refund();

create or replace function public.kurslot_spend(p_limit integer default 25, p_provider text default 'alphavantage')
returns integer
language plpgsql security definer set search_path = kurslot, pg_temp as $$
declare v_calls integer;
begin
  insert into kurslot.api_usage (day, provider, calls)
  values ((now() at time zone 'utc')::date, p_provider, 1)
  on conflict (day, provider) do update
    set calls = kurslot.api_usage.calls + 1
    where kurslot.api_usage.calls < p_limit
  returning calls into v_calls;
  return v_calls;
end;
$$;

create or replace function public.kurslot_usage(p_provider text default 'alphavantage')
returns integer
language sql security definer set search_path = kurslot, pg_temp as $$
  select coalesce((select u.calls from kurslot.api_usage u
                   where u.day = (now() at time zone 'utc')::date and u.provider = p_provider), 0);
$$;

create or replace function public.kurslot_refund(p_provider text default 'alphavantage')
returns integer
language sql security definer set search_path = kurslot, pg_temp as $$
  update kurslot.api_usage
     set calls = greatest(0, calls - 1)
   where day = (now() at time zone 'utc')::date and provider = p_provider
  returning calls;
$$;

revoke all on function public.kurslot_spend(integer, text) from public, anon, authenticated;
grant execute on function public.kurslot_spend(integer, text) to service_role;
revoke all on function public.kurslot_usage(text) from public, anon, authenticated;
grant execute on function public.kurslot_usage(text) to service_role;
revoke all on function public.kurslot_refund(text) from public, anon, authenticated;
grant execute on function public.kurslot_refund(text) to service_role;
