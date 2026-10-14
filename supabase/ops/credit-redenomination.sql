-- MANUAL. Do not run from Vercel, app startup, or supabase db push.
-- Guarded one-time 100x wallet redenomination + new plan/pack allowances.
-- Preserves credit_packs.stripe_price_id and plans.stripe_price_id.
-- Does not scale projects.totalum_spent.
--
-- Backup: this transaction copies current rows into public._rf_redenom_backup_*.
-- Rollback: supabase/ops/credit-redenomination-rollback.sql
-- Preflight: supabase/ops/credit-redenomination-preflight.sql

begin;

do $$
declare
  v_denom numeric;
  v_free integer;
  v_mult numeric;
begin
  select (value #>> '{}')::numeric into v_denom
  from public.platform_settings where key = 'credit_denomination';

  select monthly_credits into v_free from public.plans where slug = 'free';

  select (value #>> '{}')::numeric into v_mult
  from public.platform_settings where key = 'cost_multiplier';

  if v_denom = 100 then
    raise exception 'credit_denomination is already 100 — refusing to run again';
  end if;
  if v_free = 2000 then
    raise exception 'free.monthly_credits is already 2000 — refusing (looks converted or fresh-seeded)';
  end if;
  if coalesce(v_mult, 0) >= 100 then
    raise exception 'cost_multiplier is already >= 100 — refusing to run again';
  end if;
  if v_free is distinct from 20 then
    raise exception 'expected free.monthly_credits = 20 before conversion, found %', v_free;
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

delete from public._rf_redenom_backup_profiles;
delete from public._rf_redenom_backup_ledger;
delete from public._rf_redenom_backup_reservations;
delete from public._rf_redenom_backup_projects;
delete from public._rf_redenom_backup_plans;
delete from public._rf_redenom_backup_packs;
delete from public._rf_redenom_backup_settings;

insert into public._rf_redenom_backup_profiles select * from public.profiles;
insert into public._rf_redenom_backup_ledger select * from public.credit_ledger;
insert into public._rf_redenom_backup_reservations select * from public.credit_reservations;
insert into public._rf_redenom_backup_projects select * from public.projects;
insert into public._rf_redenom_backup_plans select * from public.plans;
insert into public._rf_redenom_backup_packs select * from public.credit_packs;
insert into public._rf_redenom_backup_settings select * from public.platform_settings;

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
-- totalum_spent intentionally unchanged

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

-- Allowances (not *100 of paid plans). Stripe price IDs left untouched.
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
