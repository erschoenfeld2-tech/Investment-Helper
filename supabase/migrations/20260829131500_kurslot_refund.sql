-- Ein Abruf, der an der Sekundenbremse von Alpha Vantage scheitert, hat keine
-- Daten geliefert und darf das Tagesbudget nicht belasten.
create or replace function public.kurslot_refund()
returns integer
language sql security definer set search_path = kurslot, pg_temp as $$
  update kurslot.api_usage
     set calls = greatest(0, calls - 1)
   where day = (now() at time zone 'utc')::date
  returning calls;
$$;
revoke all on function public.kurslot_refund() from public, anon, authenticated;
grant execute on function public.kurslot_refund() to service_role;
