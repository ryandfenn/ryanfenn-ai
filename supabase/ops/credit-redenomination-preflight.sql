-- Preflight for 0004 credit redenomination. Read-only. Do not apply 0004 until every
-- check is understood. Stripe Checkout sessions cannot be listed from Postgres —
-- review Dashboard → Payments → Checkout sessions (open/expired) before cutover.

-- 1) Already converted?
select key, value
from public.platform_settings
where key in ('credit_denomination', 'cost_multiplier');

select slug, monthly_credits, price_cents, stripe_price_id,
       prompt_reserve, publish_reserve, rebuild_reserve, server_reserve, domain_reserve
from public.plans
order by price_cents;

select id, name, credits, price_cents, stripe_price_id, sort_order
from public.credit_packs
order by sort_order;

-- 2) Open reservations (settle or expect *100 on the hold)
select id, user_id, project_id, operation, amount, status, created_at
from public.credit_reservations
where status = 'reserved'
order by created_at;

-- 3) Integer overflow if *100 stays in int4 (2_147_483_647)
select
  'profiles.credits' as col, max(credits) as max_val,
  (max(credits) * 100 > 2147483647) as overflows_int4
from public.profiles
union all
select 'profiles.credits_reserved', max(credits_reserved),
  (max(credits_reserved) * 100 > 2147483647)
from public.profiles
union all
select 'ledger.amount', max(abs(amount)),
  (max(abs(amount)) * 100 > 2147483647)
from public.credit_ledger
union all
select 'reservations.amount', max(abs(amount)),
  (max(abs(amount)) * 100 > 2147483647)
from public.credit_reservations
union all
select 'projects.rf_spent', max(rf_spent),
  (max(rf_spent) * 100 > 2147483647)
from public.projects;

-- 4) Duplicate grant keys (webhook/admin)
select idempotency_key, count(*)
from public.credit_ledger
where idempotency_key is not null
group by 1
having count(*) > 1;

-- 5) Pack grants that still look like old units in metadata-shaped ledger notes
select id, user_id, kind, amount, note, idempotency_key, created_at
from public.credit_ledger
where kind = 'purchase'
order by created_at desc
limit 20;

-- 6) totalum_spent must NOT be scaled (baseline)
select project_id, totalum_spent, rf_spent
from public.projects
order by created_at desc
limit 20;
