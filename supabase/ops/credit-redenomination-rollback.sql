-- MANUAL rollback from _rf_redenom_backup_* only.
-- Does NOT revert bigint columns to integer (safe superset; values after restore fit old int4).
-- Does NOT drop indexes/FKs. Does NOT delete users created after cutover — it ABORTS instead.
--
-- Rollback is UNSAFE (and this script refuses) when:
--   * Anyone signed up after conversion (mixed old/new wallets).
--   * Any ledger row exists after the backup besides redenomination:100:* notes
--     (grants, captures, admin adjusts, pack purchases).
--   * Backup tables are missing/empty.
-- After those writes, restore from the external PITR / pg_dump instead.

begin;

do $$
declare
  v_extra_users integer;
  v_extra_ledger integer;
  v_has_backup boolean;
begin
  if to_regclass('public._rf_redenom_backup_profiles') is null then
    raise exception 'backup table _rf_redenom_backup_profiles is missing';
  end if;
  execute 'select exists (select 1 from public._rf_redenom_backup_profiles)' into v_has_backup;
  if not v_has_backup then
    raise exception 'backup table _rf_redenom_backup_profiles is empty';
  end if;

  select count(*) into v_extra_users
  from public.profiles p
  where not exists (select 1 from public._rf_redenom_backup_profiles b where b.user_id = p.user_id);
  if v_extra_users > 0 then
    raise exception 'rollback unsafe: % profile(s) created after cutover', v_extra_users;
  end if;

  select count(*) into v_extra_ledger
  from public.credit_ledger l
  where coalesce(l.idempotency_key, '') not like 'redenomination:100:%'
    and not exists (select 1 from public._rf_redenom_backup_ledger b where b.id = l.id);
  if v_extra_ledger > 0 then
    raise exception 'rollback unsafe: % ledger row(s) written after cutover', v_extra_ledger;
  end if;
end $$;

update public.profiles p
set
  credits = b.credits,
  credits_reserved = b.credits_reserved,
  plan = b.plan,
  spend_limit = b.spend_limit
from public._rf_redenom_backup_profiles b
where p.user_id = b.user_id;

update public.credit_ledger l
set amount = b.amount, balance_after = b.balance_after
from public._rf_redenom_backup_ledger b
where l.id = b.id;

update public.credit_reservations r
set amount = b.amount, captured_amount = b.captured_amount
from public._rf_redenom_backup_reservations b
where r.id = b.id;

update public.projects p
set rf_spent = b.rf_spent
from public._rf_redenom_backup_projects b
where p.project_id = b.project_id;

update public.plans p
set
  monthly_credits = b.monthly_credits,
  price_cents = b.price_cents,
  prompt_reserve = b.prompt_reserve,
  publish_reserve = b.publish_reserve,
  rebuild_reserve = b.rebuild_reserve,
  server_reserve = b.server_reserve,
  domain_reserve = b.domain_reserve,
  stripe_price_id = b.stripe_price_id,
  updated_at = now()
from public._rf_redenom_backup_plans b
where p.slug = b.slug;

update public.credit_packs p
set
  credits = b.credits,
  price_cents = b.price_cents,
  stripe_price_id = b.stripe_price_id
from public._rf_redenom_backup_packs b
where p.id = b.id;

update public.platform_settings s
set value = b.value, updated_at = now()
from public._rf_redenom_backup_settings b
where s.key = b.key;

delete from public.platform_settings where key = 'credit_denomination';
delete from public.credit_ledger where idempotency_key like 'redenomination:100:%';

commit;
