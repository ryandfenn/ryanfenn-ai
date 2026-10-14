-- Record unique(name), unique(sort_order), and a unique index on non-null stripe_price_id.
-- Safe if those objects already exist (applied manually on the live project).
-- Does not INSERT, UPDATE, or DELETE credit_packs rows.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.credit_packs'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ~* '\(name\)'
  ) then
    alter table public.credit_packs add constraint credit_packs_name_key unique (name);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.credit_packs'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ~* '\(sort_order\)'
  ) then
    alter table public.credit_packs add constraint credit_packs_sort_order_key unique (sort_order);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'credit_packs'
      and indexdef ilike '%unique%'
      and indexdef ilike '%stripe_price_id%'
  ) then
    create unique index credit_packs_stripe_price_id_key
      on public.credit_packs (stripe_price_id)
      where stripe_price_id is not null;
  end if;
end $$;
