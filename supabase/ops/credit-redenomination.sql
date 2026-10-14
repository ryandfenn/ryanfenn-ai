-- MANUAL. Do not run from Vercel, app startup, or supabase db push.
-- Guarded one-time 100x wallet redenomination + new plan/pack allowances.
-- Preserves Stripe price IDs. Does not scale projects.totalum_spent.
--
-- External backup (required, in addition to _rf_redenom_backup_*):
--   Supabase Dashboard → Project Settings → Database → Backups (PITR / daily backup)
--   or: pg_dump --table=public.profiles --table=public.credit_ledger \
--         --table=public.credit_reservations --table=public.projects \
--         --table=public.plans --table=public.credit_packs --table=public.platform_settings
--
-- Never run if preflight failed. Rollback: credit-redenomination-rollback.sql

begin;

do $$
declare
  v_denom numeric;
  v_mult numeric;
  v_free integer;
  v_plan_n integer;
  v_pack_n integer;
  v_pack_names integer;
  v_open integer;
  v_pending integer;
  v_dup integer;
  v_missing_price integer;
  v_max numeric;
  v_backup boolean := false;
begin
  select (value #>> '{}')::numeric into v_denom
  from public.platform_settings where key = 'credit_denomination';
  select (value #>> '{}')::numeric into v_mult
  from public.platform_settings where key = 'cost_multiplier';
  select monthly_credits into v_free from public.plans where slug = 'free';

  select count(*) into v_plan_n from public.plans where slug in ('free', 'builder', 'pro');
  if v_plan_n is distinct from 3 then
    raise exception 'expected 3 plan rows (free, builder, pro), found %', v_plan_n;
  end if;

  select count(*) into v_pack_n from public.credit_packs;
  select count(distinct name) into v_pack_names from public.credit_packs;
  if v_pack_n is distinct from 3 or v_pack_names is distinct from 3 then
    raise exception 'expected exactly 3 uniquely named packs';
  end if;

  if v_denom = 100 then
    raise exception 'credit_denomination is already 100 — refusing to run again';
  end if;
  if v_mult is distinct from 2 then
    raise exception 'cost_multiplier must be 2 before conversion, found %', v_mult;
  end if;
  if v_free is distinct from 20 then
    raise exception 'expected free.monthly_credits = 20 before conversion, found %', v_free;
  end if;

  select count(*) into v_missing_price
  from (
    select stripe_price_id from public.plans where slug in ('builder', 'pro')
    union all
    select stripe_price_id from public.credit_packs
  ) x
  where x.stripe_price_id is null or btrim(x.stripe_price_id) = '';
  if v_missing_price > 0 then
    raise exception 'paid plan/pack is missing stripe_price_id';
  end if;

  select count(*) into v_open from public.credit_reservations where status = 'reserved';
  if v_open > 0 then
    raise exception '% open reservation(s) — aborting', v_open;
  end if;

  select count(*) into v_pending from public.stripe_events where type = 'pending';
  if v_pending > 0 then
    raise exception '% pending stripe_events — aborting', v_pending;
  end if;

  select count(*) into v_dup from (
    select idempotency_key from public.credit_ledger
    where idempotency_key is not null
    group by 1 having count(*) > 1
  ) d;
  if v_dup > 0 then
    raise exception 'duplicate ledger idempotency keys — aborting';
  end if;

  select greatest(
    coalesce((select max(credits) from public.profiles), 0),
    coalesce((select max(credits_reserved) from public.profiles), 0),
    coalesce((select max(abs(amount)) from public.credit_ledger), 0),
    coalesce((select max(abs(amount)) from public.credit_reservations), 0),
    coalesce((select max(rf_spent) from public.projects), 0)
  ) into v_max;
  if v_max * 100 > 9007199254740991::numeric then
    raise exception '×100 would exceed JavaScript MAX_SAFE_INTEGER';
  end if;

  if to_regclass('public._rf_redenom_backup_profiles') is not null then
    execute 'select exists (select 1 from public._rf_redenom_backup_profiles)' into v_backup;
    if v_backup then
      raise exception 'backup tables already populated — refusing to overwrite';
    end if;
  end if;
end $$;

create table if not exists public._rf_redenom_backup_profiles as
  select * from public.profiles where false;
create table if not exists public._rf_redenom_backup_ledger as
  select * from public.credit_ledger where false;
create table if not exists public._rf_redenom_backup_reservations as
  select * from public.credit_reservations where false;
create table if not exists public._rf_redenom_backup_projects as
  select * from public.projects where false;
create table if not exists public._rf_redenom_backup_plans as
  select * from public.plans where false;
create table if not exists public._rf_redenom_backup_packs as
  select * from public.credit_packs where false;
create table if not exists public._rf_redenom_backup_settings as
  select * from public.platform_settings where false;

-- Copy once. If a previous attempt created empty tables, this fills them.
insert into public._rf_redenom_backup_profiles select * from public.profiles;
insert into public._rf_redenom_backup_ledger select * from public.credit_ledger;
insert into public._rf_redenom_backup_reservations select * from public.credit_reservations;
insert into public._rf_redenom_backup_projects select * from public.projects;
insert into public._rf_redenom_backup_plans select * from public.plans;
insert into public._rf_redenom_backup_packs select * from public.credit_packs;
insert into public._rf_redenom_backup_settings select * from public.platform_settings;

alter table public._rf_redenom_backup_profiles enable row level security;
alter table public._rf_redenom_backup_ledger enable row level security;
alter table public._rf_redenom_backup_reservations enable row level security;
alter table public._rf_redenom_backup_projects enable row level security;
alter table public._rf_redenom_backup_plans enable row level security;
alter table public._rf_redenom_backup_packs enable row level security;
alter table public._rf_redenom_backup_settings enable row level security;

revoke all on table public._rf_redenom_backup_profiles from public, anon, authenticated;
revoke all on table public._rf_redenom_backup_ledger from public, anon, authenticated;
revoke all on table public._rf_redenom_backup_reservations from public, anon, authenticated;
revoke all on table public._rf_redenom_backup_projects from public, anon, authenticated;
revoke all on table public._rf_redenom_backup_plans from public, anon, authenticated;
revoke all on table public._rf_redenom_backup_packs from public, anon, authenticated;
revoke all on table public._rf_redenom_backup_settings from public, anon, authenticated;

grant all on table public._rf_redenom_backup_profiles to service_role;
grant all on table public._rf_redenom_backup_ledger to service_role;
grant all on table public._rf_redenom_backup_reservations to service_role;
grant all on table public._rf_redenom_backup_projects to service_role;
grant all on table public._rf_redenom_backup_plans to service_role;
grant all on table public._rf_redenom_backup_packs to service_role;
grant all on table public._rf_redenom_backup_settings to service_role;

alter table public.profiles
  alter column credits type bigint,
  alter column credits_reserved type bigint;
alter table public.credit_ledger
  alter column amount type bigint,
  alter column balance_after type bigint;
alter table public.credit_reservations
  alter column amount type bigint,
  alter column captured_amount type bigint;
alter table public.projects
  alter column rf_spent type bigint;

update public.profiles
set credits = credits * 100,
    credits_reserved = credits_reserved * 100;

update public.credit_ledger
set amount = amount * 100,
    balance_after = balance_after * 100;

update public.credit_reservations
set amount = amount * 100,
    captured_amount = captured_amount * 100;

update public.projects
set rf_spent = rf_spent * 100;

update public.platform_settings
set value = to_jsonb((value #>> '{}')::numeric * 100),
    updated_at = now()
where key = 'cost_multiplier';

update public.plans set
  prompt_reserve = prompt_reserve * 100,
  publish_reserve = publish_reserve * 100,
  rebuild_reserve = rebuild_reserve * 100,
  server_reserve = server_reserve * 100,
  domain_reserve = domain_reserve * 100,
  updated_at = now();

update public.plans set monthly_credits = 2000, price_cents = 0, updated_at = now() where slug = 'free';
update public.plans set monthly_credits = 12500, price_cents = 2900, updated_at = now() where slug = 'builder';
update public.plans set monthly_credits = 45000, price_cents = 9900, updated_at = now() where slug = 'pro';

update public.credit_packs set credits = 3500, price_cents = 900 where name = 'Starter pack';
update public.credit_packs set credits = 17500, price_cents = 3900 where name = 'Studio pack';
update public.credit_packs set credits = 60000, price_cents = 12900 where name = 'Scale pack';

insert into public.platform_settings (key, value, updated_at)
values ('credit_denomination', '100'::jsonb, now())
on conflict (key) do update set value = '100'::jsonb, updated_at = excluded.updated_at;

insert into public.credit_ledger (user_id, kind, amount, balance_after, note, idempotency_key)
select
  user_id,
  'adjustment',
  0,
  credits,
  'Redenomination x100 (balances scaled; paid allowances set to new schedule)',
  'redenomination:100:' || user_id::text
from public.profiles
on conflict (idempotency_key) do nothing;

commit;
