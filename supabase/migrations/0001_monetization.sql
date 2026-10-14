-- RyanFenn.ai customer tenancy, wallets, Stripe events, and admin-configurable plans.
-- Run this in the Supabase SQL editor (or `supabase db push`) before going live.
-- RLS: customers can read their own rows. Credits and ownership change only via
-- security-definer functions (service role).

create extension if not exists pgcrypto;

create table if not exists public.plans (
  slug text primary key,
  name text not null,
  price_cents integer not null default 0,
  monthly_credits integer not null default 0,
  max_projects integer not null default 1,
  stripe_price_id text,
  prompt_reserve integer not null default 8,
  publish_reserve integer not null default 4,
  rebuild_reserve integer not null default 2,
  server_reserve integer not null default 3,
  domain_reserve integer not null default 15,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.plans (slug, name, price_cents, monthly_credits, max_projects)
values
  ('free', 'Free', 0, 20, 1),
  ('builder', 'Builder', 2900, 250, 20),
  ('pro', 'Pro', 9900, 1000, 100)
on conflict (slug) do nothing;

create table if not exists public.credit_packs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  credits integer not null,
  price_cents integer not null,
  stripe_price_id text,
  active boolean not null default true,
  sort_order integer not null default 0
);

insert into public.credit_packs (name, credits, price_cents, sort_order)
values
  ('Starter pack', 100, 900, 1),
  ('Studio pack', 500, 3900, 2),
  ('Scale pack', 2000, 12900, 3)
on conflict do nothing;

create table if not exists public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.platform_settings (key, value) values
  ('cost_multiplier', '2.0'::jsonb),
  ('totalum_dev_limit', '40'::jsonb),
  ('totalum_infra_limit', '25'::jsonb),
  ('platform_monthly_spend_cap_totalum', '5000'::jsonb),
  ('free_launches_per_day', '3'::jsonb)
on conflict (key) do nothing;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  role text not null default 'customer' check (role in ('customer', 'admin')),
  plan text not null default 'free' references public.plans (slug),
  stripe_customer_id text unique,
  stripe_subscription_id text,
  subscription_status text,
  credits integer not null default 0 check (credits >= 0),
  credits_reserved integer not null default 0 check (credits_reserved >= 0),
  period_start timestamptz,
  period_end timestamptz,
  spend_limit integer,
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  project_id text primary key,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  totalum_spent numeric not null default 0,
  rf_spent integer not null default 0,
  spend_limit integer
);

create index if not exists projects_user_id_idx on public.projects (user_id);

create table if not exists public.credit_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  project_id text,
  operation text,
  amount integer not null,
  captured_amount integer,
  status text not null default 'reserved' check (status in ('reserved', 'captured', 'released')),
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  project_id text,
  kind text not null,
  amount integer not null,
  balance_after integer,
  reservation_id uuid references public.credit_reservations (id),
  stripe_event_id text,
  idempotency_key text unique,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);

create table if not exists public.stripe_events (
  event_id text primary key,
  type text not null,
  processed_at timestamptz not null default now()
);

create table if not exists public.rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  action text not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_limit_subject_idx on public.rate_limit_events (subject, action, created_at desc);

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.credit_reservations enable row level security;
alter table public.plans enable row level security;
alter table public.credit_packs enable row level security;
alter table public.platform_settings enable row level security;
alter table public.stripe_events enable row level security;
alter table public.rate_limit_events enable row level security;

-- No SELECT/INSERT/UPDATE/DELETE policies on platform_settings, stripe_events, or
-- rate_limit_events: anon and authenticated are denied. service_role bypasses RLS.

drop policy if exists "read own profile" on public.profiles;
drop policy if exists "read own projects" on public.projects;
drop policy if exists "read own ledger" on public.credit_ledger;
drop policy if exists "read own reservations" on public.credit_reservations;
drop policy if exists "read plans" on public.plans;
drop policy if exists "read packs" on public.credit_packs;

create policy "read own profile" on public.profiles
  for select to authenticated using (auth.uid() = user_id);
create policy "read own projects" on public.projects
  for select to authenticated using (auth.uid() = user_id);
create policy "read own ledger" on public.credit_ledger
  for select to authenticated using (auth.uid() = user_id);
create policy "read own reservations" on public.credit_reservations
  for select to authenticated using (auth.uid() = user_id);
create policy "read plans" on public.plans
  for select to anon, authenticated using (true);
create policy "read packs" on public.credit_packs
  for select to anon, authenticated using (true);

-- New auth users get a Free wallet with that plan's monthly credits.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credits integer;
  v_admin text;
  v_role text := 'customer';
begin
  select monthly_credits into v_credits from plans where slug = 'free';
  v_admin := coalesce(new.raw_user_meta_data->>'admin_seed', '');
  insert into profiles (user_id, email, role, plan, credits, period_start, period_end)
  values (
    new.id,
    new.email,
    v_role,
    'free',
    coalesce(v_credits, 20),
    now(),
    now() + interval '1 month'
  );
  insert into credit_ledger (user_id, kind, amount, balance_after, note, idempotency_key)
  values (new.id, 'grant', coalesce(v_credits, 20), coalesce(v_credits, 20), 'Welcome credits (Free plan)', 'welcome:' || new.id::text);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.reserve_credits(
  p_user_id uuid,
  p_amount integer,
  p_idempotency_key text,
  p_project_id text default null,
  p_operation text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_existing uuid;
  v_credits integer;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  select id into v_existing from credit_reservations where idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return v_existing;
  end if;

  update profiles
    set credits = credits - p_amount,
        credits_reserved = credits_reserved + p_amount
    where user_id = p_user_id
      and credits >= p_amount
    returning credits into v_credits;

  if not found then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  insert into credit_reservations (user_id, project_id, operation, amount, status, idempotency_key)
  values (p_user_id, p_project_id, p_operation, p_amount, 'reserved', p_idempotency_key)
  returning id into v_id;

  insert into credit_ledger (user_id, project_id, kind, amount, balance_after, reservation_id, idempotency_key)
  values (p_user_id, p_project_id, 'reserve', -p_amount, v_credits, v_id, p_idempotency_key || ':reserve');

  return v_id;
end;
$$;

create or replace function public.capture_credits(
  p_reservation_id uuid,
  p_actual integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row credit_reservations%rowtype;
  v_refund integer;
  v_extra integer;
  v_credits integer;
begin
  select * into v_row from credit_reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND';
  end if;
  if v_row.status <> 'reserved' then
    return;
  end if;

  v_refund := greatest(v_row.amount - greatest(p_actual, 0), 0);
  v_extra := greatest(greatest(p_actual, 0) - v_row.amount, 0);

  update profiles
    set credits_reserved = credits_reserved - v_row.amount,
        credits = credits + v_refund - least(v_extra, credits + v_refund)
    where user_id = v_row.user_id
    returning credits into v_credits;

  update credit_reservations
    set status = 'captured',
        captured_amount = greatest(p_actual, 0),
        closed_at = now()
    where id = p_reservation_id;

  insert into credit_ledger (user_id, project_id, kind, amount, balance_after, reservation_id, idempotency_key)
  values (
    v_row.user_id,
    v_row.project_id,
    'capture',
    -greatest(p_actual, 0) + v_row.amount,
    v_credits,
    p_reservation_id,
    p_reservation_id::text || ':capture'
  )
  on conflict (idempotency_key) do nothing;

  if v_row.project_id is not null then
    update projects
      set rf_spent = rf_spent + greatest(p_actual, 0)
      where project_id = v_row.project_id;
  end if;
end;
$$;

create or replace function public.release_credits(p_reservation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row credit_reservations%rowtype;
  v_credits integer;
begin
  select * into v_row from credit_reservations where id = p_reservation_id for update;
  if not found or v_row.status <> 'reserved' then
    return;
  end if;

  update profiles
    set credits = credits + v_row.amount,
        credits_reserved = credits_reserved - v_row.amount
    where user_id = v_row.user_id
    returning credits into v_credits;

  update credit_reservations
    set status = 'released', closed_at = now()
    where id = p_reservation_id;

  insert into credit_ledger (user_id, project_id, kind, amount, balance_after, reservation_id, idempotency_key)
  values (v_row.user_id, v_row.project_id, 'release', v_row.amount, v_credits, p_reservation_id, p_reservation_id::text || ':release')
  on conflict (idempotency_key) do nothing;
end;
$$;

create or replace function public.adjust_credits(
  p_user_id uuid,
  p_amount integer,
  p_note text,
  p_idempotency_key text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credits integer;
begin
  insert into credit_ledger (user_id, kind, amount, note, idempotency_key)
  values (p_user_id, 'adjustment', 0, p_note, p_idempotency_key)
  on conflict (idempotency_key) do nothing;
  if not found then
    select credits into v_credits from profiles where user_id = p_user_id;
    return v_credits;
  end if;

  update profiles
    set credits = greatest(credits + p_amount, 0)
    where user_id = p_user_id
    returning credits into v_credits;

  update credit_ledger
    set amount = p_amount, balance_after = v_credits
    where idempotency_key = p_idempotency_key;

  return v_credits;
end;
$$;

create or replace function public.grant_credits(
  p_user_id uuid,
  p_amount integer,
  p_kind text,
  p_note text,
  p_stripe_event_id text,
  p_idempotency_key text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credits integer;
begin
  if exists (select 1 from credit_ledger where idempotency_key = p_idempotency_key) then
    select credits into v_credits from profiles where user_id = p_user_id;
    return v_credits;
  end if;

  update profiles
    set credits = credits + p_amount
    where user_id = p_user_id
    returning credits into v_credits;

  insert into credit_ledger (user_id, kind, amount, balance_after, stripe_event_id, note, idempotency_key)
  values (p_user_id, p_kind, p_amount, v_credits, p_stripe_event_id, p_note, p_idempotency_key);

  return v_credits;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- CREATE FUNCTION grants EXECUTE to PUBLIC in Postgres. These helpers run as
-- SECURITY DEFINER (table owner), so anon/authenticated must not be able to
-- call them via PostgREST with an arbitrary user_id.
-- ---------------------------------------------------------------------------

revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to postgres, supabase_auth_admin;

revoke all on function public.reserve_credits(uuid, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.reserve_credits(uuid, integer, text, text, text) to service_role;

revoke all on function public.capture_credits(uuid, integer) from public, anon, authenticated;
grant execute on function public.capture_credits(uuid, integer) to service_role;

revoke all on function public.release_credits(uuid) from public, anon, authenticated;
grant execute on function public.release_credits(uuid) to service_role;

revoke all on function public.adjust_credits(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.adjust_credits(uuid, integer, text, text) to service_role;

revoke all on function public.grant_credits(uuid, integer, text, text, text, text) from public, anon, authenticated;
grant execute on function public.grant_credits(uuid, integer, text, text, text, text) to service_role;

-- Defense in depth: even with RLS, do not leave INSERT/UPDATE/DELETE to browser roles.
revoke all on table public.profiles from public, anon, authenticated;
revoke all on table public.projects from public, anon, authenticated;
revoke all on table public.credit_ledger from public, anon, authenticated;
revoke all on table public.credit_reservations from public, anon, authenticated;
revoke all on table public.platform_settings from public, anon, authenticated;
revoke all on table public.stripe_events from public, anon, authenticated;
revoke all on table public.rate_limit_events from public, anon, authenticated;
revoke all on table public.plans from public, anon, authenticated;
revoke all on table public.credit_packs from public, anon, authenticated;

grant select on table public.profiles to authenticated;
grant select on table public.projects to authenticated;
grant select on table public.credit_ledger to authenticated;
grant select on table public.credit_reservations to authenticated;
grant select on table public.plans to anon, authenticated;
grant select on table public.credit_packs to anon, authenticated;

grant all on table public.profiles to service_role;
grant all on table public.projects to service_role;
grant all on table public.credit_ledger to service_role;
grant all on table public.credit_reservations to service_role;
grant all on table public.platform_settings to service_role;
grant all on table public.stripe_events to service_role;
grant all on table public.rate_limit_events to service_role;
grant all on table public.plans to service_role;
grant all on table public.credit_packs to service_role;
