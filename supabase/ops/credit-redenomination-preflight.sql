-- Read-only aborting preflight. If this script completes, SQL-visible conditions are safe.
-- It CANNOT see Stripe Checkout sessions, webhook retries, or in-flight Totalum agent runs.
--
-- Stripe checks (Dashboard / CLI) before conversion:
--   * No open Checkout sessions (complete, expire, or cancel them).
--   * Pause the webhook endpoint or rely on BILLING_MAINTENANCE=true (app returns 503; Stripe retries).
--   * No agent runs in progress (workspace "building"); open reservations are aborted below.

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
    raise exception 'preflight: expected 3 plan rows (free, builder, pro), found %', v_plan_n;
  end if;
  if exists (select 1 from public.plans group by slug having count(*) > 1) then
    raise exception 'preflight: duplicate plan slugs';
  end if;

  select count(*) into v_pack_n from public.credit_packs;
  select count(distinct name) into v_pack_names from public.credit_packs;
  if v_pack_n is distinct from 3 or v_pack_names is distinct from 3 then
    raise exception 'preflight: expected exactly 3 uniquely named packs, found % rows / % names', v_pack_n, v_pack_names;
  end if;
  if not exists (select 1 from public.credit_packs where name = 'Starter pack')
     or not exists (select 1 from public.credit_packs where name = 'Studio pack')
     or not exists (select 1 from public.credit_packs where name = 'Scale pack') then
    raise exception 'preflight: missing Starter/Studio/Scale pack name';
  end if;

  if v_denom = 100 then
    raise exception 'preflight: credit_denomination is already 100';
  end if;
  if v_mult is distinct from 2 then
    raise exception 'preflight: cost_multiplier must be 2 before conversion, found %', v_mult;
  end if;
  if v_free is distinct from 20 then
    raise exception 'preflight: free.monthly_credits must be 20 before conversion, found %', v_free;
  end if;

  select count(*) into v_missing_price
  from (
    select stripe_price_id from public.plans where slug in ('builder', 'pro')
    union all
    select stripe_price_id from public.credit_packs
  ) x
  where x.stripe_price_id is null or btrim(x.stripe_price_id) = '';
  if v_missing_price > 0 then
    raise exception 'preflight: paid plan/pack is missing stripe_price_id';
  end if;

  select count(*) into v_open from public.credit_reservations where status = 'reserved';
  if v_open > 0 then
    raise exception 'preflight: % open reservation(s) — wait for agent/status capture or release first', v_open;
  end if;

  select count(*) into v_pending from public.stripe_events where type = 'pending';
  if v_pending > 0 then
    raise exception 'preflight: % pending stripe_events (queued/unfinished webhooks)', v_pending;
  end if;

  select count(*) into v_dup from (
    select idempotency_key from public.credit_ledger
    where idempotency_key is not null
    group by 1 having count(*) > 1
  ) d;
  if v_dup > 0 then
    raise exception 'preflight: duplicate credit_ledger.idempotency_key values exist';
  end if;

  select greatest(
    coalesce((select max(credits) from public.profiles), 0),
    coalesce((select max(credits_reserved) from public.profiles), 0),
    coalesce((select max(abs(amount)) from public.credit_ledger), 0),
    coalesce((select max(abs(amount)) from public.credit_reservations), 0),
    coalesce((select max(rf_spent) from public.projects), 0)
  ) into v_max;
  if v_max * 100 > 9007199254740991::numeric then
    raise exception 'preflight: ×100 would exceed JavaScript MAX_SAFE_INTEGER (max abs %)', v_max;
  end if;

  if to_regclass('public._rf_redenom_backup_profiles') is not null then
    execute 'select exists (select 1 from public._rf_redenom_backup_profiles)' into v_backup;
    if v_backup then
      raise exception 'preflight: _rf_redenom_backup_* already has rows — will not overwrite';
    end if;
  end if;

  raise notice 'preflight SQL checks passed. Still confirm Stripe Dashboard: no open Checkout sessions; webhook paused or BILLING_MAINTENANCE=true; no in-flight Totalum agent runs.';
end $$;

-- Diagnostic listing (only reached if the abort block passed)
select slug, monthly_credits, price_cents, stripe_price_id,
       prompt_reserve, publish_reserve, rebuild_reserve, server_reserve, domain_reserve
from public.plans order by price_cents;

select id, name, credits, price_cents, stripe_price_id, sort_order
from public.credit_packs order by sort_order;
