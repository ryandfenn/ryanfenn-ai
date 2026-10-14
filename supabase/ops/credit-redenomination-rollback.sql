-- MANUAL rollback. Restores rows from _rf_redenom_backup_* created by
-- credit-redenomination.sql. Does not drop live tables. Run only if conversion
-- succeeded and you need the previous denomination.

begin;

do $$
begin
  if not exists (select 1 from public._rf_redenom_backup_profiles) then
    raise exception 'backup table _rf_redenom_backup_profiles is missing or empty';
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
