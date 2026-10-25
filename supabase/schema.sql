-- Gunshot detection & localization schema. Safe to re-run.

create extension if not exists pgcrypto;

create table if not exists rooms (
  id   text primary key,
  name text not null,
  x    float8 not null,  -- room center, meters on floor plan
  y    float8 not null
);

create table if not exists devices (
  id              uuid primary key default gen_random_uuid(),
  room_id         text not null references rooms(id),
  lat             float8,
  lng             float8,
  clock_offset_ms float8 not null default 0,
  gain_offset_db  float8 not null default 0,
  last_seen       timestamptz not null default now()
);

create table if not exists incidents (
  id              uuid primary key default gen_random_uuid(),
  status          text not null default 'active' check (status in ('active', 'cleared')),
  started_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  best_x          float8,
  best_y          float8,
  best_room_id    text,
  heatmap         jsonb,
  trail           jsonb not null default '[]',
  detection_count int not null default 0,
  summary         text
);

-- At most one active incident at a time.
create unique index if not exists incidents_one_active on incidents (status) where status = 'active';

create table if not exists detections (
  id           uuid primary key default gen_random_uuid(),
  incident_id  uuid not null references incidents(id) on delete cascade,
  device_id    uuid not null references devices(id) on delete cascade,
  room_id      text,
  spike_ts_ms  float8 not null,  -- server-corrected epoch ms
  raw_peak_db  float8 not null,
  norm_peak_db float8 not null,
  confidence   float8,
  label        text,
  created_at   timestamptz not null default now()
);

create index if not exists detections_incident_ts on detections (incident_id, spike_ts_ms);

create table if not exists alerts (
  id          uuid primary key default gen_random_uuid(),
  incident_id uuid references incidents(id) on delete set null,
  type        text not null check (type in ('alert', 'all_clear')),
  created_at  timestamptz not null default now()
);

create table if not exists statuses (
  device_id  uuid primary key references devices(id) on delete cascade,
  room_id    text,
  status     text not null check (status in ('safe', 'need_help', 'injured')),
  updated_at timestamptz not null default now()
);

-- Exact phone position in meters (optional). When null, the room center is used.
-- Detections keep the position they were heard from, so moving a phone later doesn't rewrite history.
alter table devices    add column if not exists x float8, add column if not exists y float8;
alter table detections add column if not exists x float8, add column if not exists y float8;

-- Timing calibration: each phone's constant arrival-time bias (audio pipeline delay etc.),
-- measured from a reference sound at a known spot and subtracted from every detection.
alter table devices add column if not exists time_offset_ms float8 not null default 0;

-- How much to trust each detection's arrival time (see timeSigmaMs in lib/localize.ts).
alter table devices    add column if not exists time_calibrated_at timestamptz;
alter table devices    add column if not exists clock_rtt_ms float8;  -- round trip of the best clock-sync sample
alter table detections add column if not exists time_sigma_ms float8;  -- expected arrival-time error when heard

-- Geo mode: phones placed on the real map (lat/lng) instead of the demo floor plan ("grid").
-- An incident uses one frame, set by its first detection; phones in the other frame are turned away.
alter table devices alter column room_id drop not null;  -- geo phones have no room
alter table devices add column if not exists frame text not null default 'grid' check (frame in ('grid', 'geo'));
alter table devices add column if not exists pos_accuracy_m float8;  -- geo: reported accuracy radius (or a hand-placed pin's)
alter table devices add column if not exists place_label text;  -- geo: what the user called the spot, e.g. "Room 214"
alter table detections
  add column if not exists lat float8,
  add column if not exists lng float8,
  add column if not exists pos_sigma_m float8;  -- how far the recorded position may be off (1σ)
alter table incidents
  add column if not exists frame text check (frame in ('grid', 'geo')),
  add column if not exists origin_lat float8,  -- geo: x/y, trail and heatmap are meters east/north of this
  add column if not exists origin_lng float8,
  add column if not exists best_lat float8,
  add column if not exists best_lng float8,
  add column if not exists best_label text;  -- room name (grid) or nearest phone's label (geo)

create table if not exists timing_calibrations (
  id          uuid primary key default gen_random_uuid(),
  x           float8 not null,  -- where the reference sound is made
  y           float8 not null,
  status      text not null default 'listening' check (status in ('listening', 'done', 'cancelled')),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  results     jsonb
);
create unique index if not exists timing_calibrations_one_active on timing_calibrations (status) where status = 'listening';

create table if not exists timing_cal_reports (
  calibration_id uuid not null references timing_calibrations(id) on delete cascade,
  device_id      uuid not null references devices(id) on delete cascade,
  x              float8 not null,  -- phone position when it heard the reference
  y              float8 not null,
  spike_ts_ms    float8 not null,  -- server clock, before this calibration's correction
  peak_db        float8 not null,
  created_at     timestamptz not null default now(),
  primary key (calibration_id, device_id)
);

-- Geo mode: the reference spot and phones are lat/lng instead of floor-plan x/y.
alter table timing_calibrations
  add column if not exists frame text not null default 'grid' check (frame in ('grid', 'geo')),
  add column if not exists lat float8,
  add column if not exists lng float8,
  alter column x drop not null,
  alter column y drop not null;
alter table timing_cal_reports
  add column if not exists lat float8,
  add column if not exists lng float8,
  alter column x drop not null,
  alter column y drop not null;

-- Localization runs once per batch of new detections, not once per detection (lib/localizeIncident.ts):
-- a request takes a short lease on the incident, then processes every detection newer than loc_done_at.
alter table incidents
  add column if not exists loc_lease_until timestamptz,
  add column if not exists loc_done_at     timestamptz;

-- The heatmap (tens of KB) lives here, not on incidents: phones subscribe to incident changes over
-- Realtime and would otherwise receive the whole heatmap on every update. Not in the publication.
create table if not exists incident_heatmaps (
  incident_id uuid primary key references incidents(id) on delete cascade,
  heatmap     jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Phone settings, set from the incident dashboard (lib/phoneSettings.ts). A phone uses the built-in
-- defaults, overridden by the all-phones settings (app_settings 'phone_defaults'), overridden by its own.
alter table devices
  add column if not exists settings             jsonb not null default '{}',
  add column if not exists mic_cal_requested_at timestamptz,  -- dashboard asked this phone to calibrate its mic
  add column if not exists gain_calibrated_at   timestamptz;
create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- RLS: anon (publishable key) can only read rooms/incidents/alerts/statuses.
-- All writes go through API routes using the secret key, which bypasses RLS.
alter table rooms      enable row level security;
alter table devices    enable row level security;
alter table incidents  enable row level security;
alter table detections enable row level security;
alter table alerts     enable row level security;
alter table statuses   enable row level security;
alter table timing_calibrations enable row level security;
alter table timing_cal_reports  enable row level security;
alter table incident_heatmaps   enable row level security;
alter table app_settings        enable row level security;

-- Explicit grants so this works with "Automatically expose new tables" turned off.
revoke all on rooms, devices, incidents, detections, alerts, statuses from anon, authenticated;
grant select on rooms, incidents, alerts, statuses to anon;
grant all on rooms, devices, incidents, detections, alerts, statuses to service_role;
revoke all on timing_calibrations, timing_cal_reports from anon, authenticated;
grant all on timing_calibrations, timing_cal_reports to service_role;
revoke all on incident_heatmaps from anon, authenticated;
grant all on incident_heatmaps to service_role;
revoke all on app_settings from anon, authenticated;
grant all on app_settings to service_role;

drop policy if exists anon_read on rooms;
drop policy if exists anon_read on incidents;
drop policy if exists anon_read on alerts;
drop policy if exists anon_read on statuses;
create policy anon_read on rooms     for select to anon using (true);
create policy anon_read on incidents for select to anon using (true);
create policy anon_read on alerts    for select to anon using (true);
create policy anon_read on statuses  for select to anon using (true);

-- Realtime
do $$
declare t text;
begin
  foreach t in array array['incidents', 'alerts', 'statuses'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
