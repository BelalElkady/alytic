-- White-label platform registry. Run this ONLY in the platform database — the
-- Supabase project in backend/.env (SUPABASE_URL), after schema.sql.
--
-- Each client (tenant) gets its own Supabase project, with schema.sql run in
-- it and nothing else. That project holds only that client's users,
-- portfolios, subscriptions, support chat and blog. This file adds the list
-- of tenants and how to reach each one, which only the platform database
-- (and so only you) has.
--
-- The market data every client reads (market_reports, ai_stop_plans,
-- fundamentals_cache, index_overrides, investor_flows, custom_stocks) always lives in the
-- platform database, so the daily AI market work is paid for once and not
-- once per client. The same tables exist but stay empty in client databases.
--
-- The original site is the "default" tenant (DEFAULT_TENANT_ID, 'egxpert'
-- unless set). Its data stays where it has always been, in this database. It
-- needs no row here; add one only to override its branding.
--
-- Safe to re-run.

create table if not exists tenants (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,30}$'),
  name text not null,
  -- null for the default tenant, whose data is in this database.
  supabase_url text,
  -- The client project's service_role key, encrypted with TENANT_SECRETS_KEY
  -- (see src/tenancy/secrets.js). Never stored or returned in plain text.
  supabase_key_enc text,
  -- Logo, colors, name, analytics IDs: everything the site looks like. See
  -- DEFAULT_BRAND in src/tenancy/registry.js for the fields.
  brand_json jsonb not null default '{}',
  -- Behaviour: sender address, admin emails, InstaPay details, prices,
  -- feature switches. See defaultConfigFromEnv() in the same file.
  config_json jsonb not null default '{}',
  status text not null default 'active' check (status in ('active', 'suspended')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Which hostnames serve which tenant. The hostname is stored without "www."
-- (www.example.com is served as example.com), in lower case, without a port.
create table if not exists tenant_domains (
  domain text primary key,
  tenant_id text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_tenant_domains_tenant on tenant_domains (tenant_id);

-- Platform-wide settings, one JSON document per key. Today only 'tiers': the
-- default caps, Portfolio cap, page/panel locks and pricing-card text for each
-- tier, which every site inherits unless its own config_json.tiers overrides
-- a field. Edited from the platform panel; see resolveTiers() in
-- src/billing/plans.js. No row means the built-in defaults apply.
create table if not exists platform_settings (
  key text primary key,
  value jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- Which tenant spent each AI call, so each client's AI cost can be billed.
-- Rows from before this column existed stay null (all of them are the
-- default site's).
alter table ai_spend add column if not exists tenant_id text;
create index if not exists ai_spend_tenant_created_idx on ai_spend (tenant_id, created_at);

-- Same lock-down as the end of schema.sql, for the new tables.
alter table tenants enable row level security;
alter table tenant_domains enable row level security;
alter table platform_settings enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on tenants, tenant_domains, platform_settings from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on tenants, tenant_domains, platform_settings from authenticated;
  end if;
end $$;
