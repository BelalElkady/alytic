-- Mobile app (Capacitor) tables: registered devices and the notification log.
--
-- Idempotent. Apply to the platform database AND to every white-label
-- tenant's database (each tenant keeps its own users, so each needs these
-- tables). It is also appended to schema.sql for fresh installs.

create table if not exists mobile_devices (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id) on delete cascade,
  -- Random id the app generates on first launch (not a hardware identifier).
  device_id text not null,
  platform text not null check (platform in ('android', 'ios')),
  -- FCM registration token. A credential-like value: never logged, never
  -- returned by the API after registration.
  push_token text not null,
  app_version text,
  os_version text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, device_id)
);
create index if not exists mobile_devices_user_enabled_idx on mobile_devices (user_id) where enabled;
create index if not exists mobile_devices_token_idx on mobile_devices (push_token);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id) on delete cascade,
  -- See src/notifications/types.js for the allowed values.
  type text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  sent_at timestamptz
);
create index if not exists notifications_user_created_idx on notifications (user_id, created_at desc);
create index if not exists notifications_dedupe_idx on notifications (user_id, (data ->> 'dedupeKey'));

-- Same lock-down as every other table: only the backend (service role) reads or writes.
alter table mobile_devices enable row level security;
alter table notifications enable row level security;
