-- Kurslot: Cache-Schicht vor Alpha Vantage (25 Abrufe/Tag im Gratis-Tarif)
create schema if not exists kurslot;

-- Geheimnisse: nur über service_role lesbar (RLS an, keine Policies)
create table if not exists kurslot.app_secrets (
  name        text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);
alter table kurslot.app_secrets enable row level security;

-- Ein Cache-Eintrag je (Art, Schlüssel). payload ist die rohe Antwort.
create table if not exists kurslot.cache (
  kind        text not null,
  key         text not null,
  payload     jsonb not null,
  fetched_at  timestamptz not null default now(),
  primary key (kind, key)
);
alter table kurslot.cache enable row level security;
create index if not exists cache_fetched_at_idx on kurslot.cache (fetched_at desc);

-- Tagesbudget: eine Zeile je Tag, damit wir die 25 Abrufe nicht überziehen
create table if not exists kurslot.api_usage (
  day    date primary key default (now() at time zone 'utc')::date,
  calls  integer not null default 0
);
alter table kurslot.api_usage enable row level security;

comment on schema kurslot is 'Cache und Budgetsteuerung für die Kurslot-Marktdaten';
comment on table kurslot.cache is 'Rohantworten von Alpha Vantage, nach Art und Symbol';
