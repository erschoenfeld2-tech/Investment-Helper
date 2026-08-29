-- Das Schema kurslot ist über die REST-API nicht freigegeben (und soll es nicht sein).
-- Die Edge Function erreicht es deshalb über schmale Funktionen in public,
-- die nur die service_role aufrufen darf.

create or replace function public.kurslot_get(p_kind text, p_key text)
returns table (payload jsonb, fetched_at timestamptz)
language sql security definer set search_path = kurslot, pg_temp as $$
  select c.payload, c.fetched_at from kurslot.cache c
  where c.kind = p_kind and c.key = p_key;
$$;

create or replace function public.kurslot_put(p_kind text, p_key text, p_payload jsonb)
returns timestamptz
language sql security definer set search_path = kurslot, pg_temp as $$
  insert into kurslot.cache (kind, key, payload, fetched_at)
  values (p_kind, p_key, p_payload, now())
  on conflict (kind, key) do update
    set payload = excluded.payload, fetched_at = excluded.fetched_at
  returning fetched_at;
$$;

-- Erhöht den Tageszähler, aber nur solange Budget übrig ist.
-- Rückgabe NULL bedeutet: Tagesbudget erschöpft.
create or replace function public.kurslot_spend(p_limit integer default 25)
returns integer
language plpgsql security definer set search_path = kurslot, pg_temp as $$
declare v_calls integer;
begin
  insert into kurslot.api_usage (day, calls)
  values ((now() at time zone 'utc')::date, 1)
  on conflict (day) do update
    set calls = kurslot.api_usage.calls + 1
    where kurslot.api_usage.calls < p_limit
  returning calls into v_calls;
  return v_calls;
end;
$$;

create or replace function public.kurslot_usage()
returns integer
language sql security definer set search_path = kurslot, pg_temp as $$
  select coalesce((select u.calls from kurslot.api_usage u
                   where u.day = (now() at time zone 'utc')::date), 0);
$$;

create or replace function public.kurslot_secret(p_name text)
returns text
language sql security definer set search_path = kurslot, pg_temp as $$
  select s.value from kurslot.app_secrets s where s.name = p_name;
$$;

-- Niemand außer der service_role darf diese Funktionen aufrufen.
do $$
declare f text;
begin
  foreach f in array array[
    'public.kurslot_get(text,text)',
    'public.kurslot_put(text,text,jsonb)',
    'public.kurslot_spend(integer)',
    'public.kurslot_usage()',
    'public.kurslot_secret(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
