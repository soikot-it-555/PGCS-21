-- PGCS-21 Migration v3: income-year catalog and payment deletion audit
-- Run after supabase-migration-v2.sql. Idempotent; preserves existing records.

-- The application stores these collections as app_state documents so the existing
-- record-level CAS/realtime sync remains compatible with localhost and GitHub Pages.
insert into app_state(key, value)
values ('pgcs_income_years_v1', '[]'::jsonb)
on conflict (key) do nothing;

insert into app_state(key, value)
values ('pgcs_payment_audit_v1', '[]'::jsonb)
on conflict (key) do nothing;

-- Queryable audit history for server-side retention and reporting. The frontend
-- continues writing the synchronized app_state audit document for compatibility.
create table if not exists payment_deletion_audit (
  id bigserial primary key,
  payment_id bigint not null,
  deleted_by text not null,
  deleted_at timestamptz not null default now(),
  reason text not null check (length(trim(reason)) > 0),
  previous_status text not null,
  payment_snapshot jsonb not null,
  created_at timestamptz not null default now()
);

alter table payment_deletion_audit enable row level security;
drop policy if exists "pgcs payment audit select" on payment_deletion_audit;
drop policy if exists "pgcs payment audit insert" on payment_deletion_audit;
create policy "pgcs payment audit select" on payment_deletion_audit for select using (true);
create policy "pgcs payment audit insert" on payment_deletion_audit for insert with check (length(trim(reason)) > 0);

create index if not exists payment_deletion_audit_payment_idx on payment_deletion_audit(payment_id);
create index if not exists payment_deletion_audit_deleted_at_idx on payment_deletion_audit(deleted_at);

-- Realtime for the synchronized app_state documents (safe if already published).
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='app_state') then
    alter publication supabase_realtime add table public.app_state;
  end if;
exception when undefined_object then null;
end $$;

-- Payment rows are retained and marked Voided by the client. This trigger rejects
-- accidental attempts to physically delete an Approved payment through the API.
create or replace function pgcs_protect_approved_payment_delete() returns trigger
language plpgsql as $$
begin
  if coalesce(old.data->>'status','') = 'Approved' then
    raise exception 'Approved payments must be voided, not physically deleted';
  end if;
  return old;
end $$;

drop trigger if exists payments_protect_approved_delete on payments;
create trigger payments_protect_approved_delete
before delete on payments for each row execute function pgcs_protect_approved_payment_delete();
