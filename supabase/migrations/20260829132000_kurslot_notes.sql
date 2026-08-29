-- Redaktionelle Einordnung je Symbol: Schwankungstreiber und Namen der
-- Schockphasen. Wird von Hand gepflegt, von der Web-App nur gelesen.
create table if not exists kurslot.notes (
  symbol      text primary key,
  drivers     jsonb not null default '[]'::jsonb,
  episodes    jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);
alter table kurslot.notes enable row level security;

-- Diese Inhalte sind nicht vertraulich: Lesen ist für die App freigegeben,
-- Schreiben bleibt der service_role vorbehalten.
create or replace function public.kurslot_notes(p_symbol text)
returns table (drivers jsonb, episodes jsonb, updated_at timestamptz)
language sql stable security definer set search_path = kurslot, pg_temp as $$
  select n.drivers, n.episodes, n.updated_at
  from kurslot.notes n where n.symbol = upper(p_symbol);
$$;
revoke all on function public.kurslot_notes(text) from public;
grant execute on function public.kurslot_notes(text) to anon, authenticated, service_role;

create or replace function public.kurslot_notes_put(p_symbol text, p_drivers jsonb, p_episodes jsonb)
returns timestamptz
language sql security definer set search_path = kurslot, pg_temp as $$
  insert into kurslot.notes (symbol, drivers, episodes, updated_at)
  values (upper(p_symbol), coalesce(p_drivers,'[]'::jsonb), coalesce(p_episodes,'[]'::jsonb), now())
  on conflict (symbol) do update
    set drivers = excluded.drivers, episodes = excluded.episodes, updated_at = now()
  returning updated_at;
$$;
revoke all on function public.kurslot_notes_put(text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.kurslot_notes_put(text,jsonb,jsonb) to service_role;
