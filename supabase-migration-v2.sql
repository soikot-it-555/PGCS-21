-- =====================================================================
-- PGCS-21 — Migration v2  (two-way sync, conflict-safe, Realtime)
-- Run ONCE in Supabase → SQL Editor, AFTER the original supabase-setup.sql.
-- 100% idempotent (safe to run again). No existing row is changed or deleted.
-- =====================================================================

-- 1) version + created_at on every synced table -------------------------
alter table app_state         add column if not exists version    bigint      not null default 1;
alter table app_state         add column if not exists created_at timestamptz not null default now();
alter table payments          add column if not exists version    bigint      not null default 1;
alter table payments          add column if not exists created_at timestamptz not null default now();
alter table fin_transactions  add column if not exists version    bigint      not null default 1;
alter table fin_transactions  add column if not exists created_at timestamptz not null default now();

-- 2) dedicated, queryable columns for financial transactions (data jsonb stays the source) ----
alter table fin_transactions add column if not exists tx_type    text;
alter table fin_transactions add column if not exists tx_date    date;
alter table fin_transactions add column if not exists amount     numeric(14,2);
alter table fin_transactions add column if not exists category   text;
alter table fin_transactions add column if not exists description text;
alter table fin_transactions add column if not exists status     text not null default 'posted';
alter table fin_transactions add column if not exists created_by text;
alter table fin_transactions add column if not exists doc_paths  text[] not null default '{}';

-- 3) server-side version / timestamp (clients can never forge them) -----------------
create or replace function pgcs_touch() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1; new.updated_at := now();
  else
    new.version := old.version + 1; new.updated_at := now();
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

create or replace function pgcs_fin_denorm() returns trigger language plpgsql as $$
begin
  new.tx_type     := new.data->>'type';
  new.category    := coalesce(new.data->>'cat', new.data->>'liab', new.data->>'acc');
  new.description := new.data->>'note';
  new.created_by  := coalesce(new.data->>'by', new.created_by);
  begin new.tx_date := (new.data->>'date')::date;  exception when others then new.tx_date := null; end;
  begin new.amount  := (new.data->>'amount')::numeric; exception when others then new.amount := null; end;
  new.doc_paths := coalesce((select array_agg(d->>'path') from jsonb_array_elements(coalesce(new.data->'docs','[]'::jsonb)) d), '{}');
  return new;
end $$;

drop trigger if exists app_state_touch on app_state;
drop trigger if exists payments_touch on payments;
drop trigger if exists fin_tx_touch on fin_transactions;
drop trigger if exists fin_tx_denorm on fin_transactions;
create trigger app_state_touch before insert or update on app_state        for each row execute function pgcs_touch();
create trigger payments_touch  before insert or update on payments         for each row execute function pgcs_touch();
create trigger fin_tx_touch    before insert or update on fin_transactions for each row execute function pgcs_touch();
create trigger fin_tx_denorm   before insert or update on fin_transactions for each row execute function pgcs_fin_denorm();

-- 4) change log: every UPDATE/DELETE keeps the previous copy => data can never be silently lost ----
create table if not exists change_log (
  id bigserial primary key,
  table_name text not null, row_id text not null, op text not null,
  old_data jsonb, changed_at timestamptz not null default now()
);
alter table change_log enable row level security;           -- no policy => not readable/writable with the anon key
create or replace function pgcs_log() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into change_log(table_name,row_id,op,old_data)
  values (tg_table_name, old.id::text, tg_op, to_jsonb(old));
  return coalesce(new, old);
exception when others then
  return coalesce(new, old);     -- logging must never block a save
end $$;
-- pgcs_log: tables keyed by "id" (payments, fin_transactions); pgcs_log_state: app_state (keyed by "key")
create or replace function pgcs_log_state() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into change_log(table_name,row_id,op,old_data) values ('app_state', old.key, tg_op, to_jsonb(old));
  return coalesce(new, old);
exception when others then return coalesce(new, old);
end $$;
drop trigger if exists payments_log on payments;
drop trigger if exists fin_tx_log on fin_transactions;
drop trigger if exists app_state_log on app_state;
create trigger payments_log  after update or delete on payments         for each row execute function pgcs_log();
create trigger fin_tx_log    after update or delete on fin_transactions for each row execute function pgcs_log();
create trigger app_state_log after update or delete on app_state        for each row execute function pgcs_log_state();

-- 5) PRESERVE legacy financial transactions (old settings.fin.tx) — duplicate-safe -----------------
insert into fin_transactions (id, data)
select t->>'id', t
from app_state s, jsonb_array_elements(coalesce(s.value->'fin'->'tx','[]'::jsonb)) t
where s.key = 'pgcs_settings_v1' and t ? 'id'
on conflict (id) do nothing;

-- 6) mark an existing database as initialised, so INITIAL_PAYMENTS can never be re-seeded over it ------
insert into app_state(key, value)
select '_initialized', jsonb_build_object('at', now(), 'by', 'migration-v2')
where exists (select 1 from payments) or exists (select 1 from app_state where key <> '_initialized')
on conflict (key) do nothing;

-- 7) Realtime: publish the three tables ---------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['app_state','payments','fin_transactions'] loop
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- 8) Row Level Security — tightened WITHOUT breaking the current password-in-the-browser login ----
--    (the old "for all using(true)" policies are replaced by one policy per action)
do $$ declare t text; begin
  foreach t in array array['app_state','payments','fin_transactions'] loop
    execute format('drop policy if exists "Allow all operations for anon users" on %I', t);
    execute format('drop policy if exists "Allow all operations for anon users on %s" on %I', t, t);
    execute format('drop policy if exists "pgcs select" on %I', t);
    execute format('drop policy if exists "pgcs insert" on %I', t);
    execute format('drop policy if exists "pgcs update" on %I', t);
    execute format('drop policy if exists "pgcs delete" on %I', t);
    execute format('create policy "pgcs select" on %I for select using (true)', t);
    execute format('create policy "pgcs insert" on %I for insert with check (true)', t);
    execute format('create policy "pgcs update" on %I for update using (true) with check (true)', t);
  end loop;
end $$;
-- the app never deletes app_state rows => forbid it. Payments / transactions may be deleted (record-level).
create policy "pgcs delete" on payments         for delete using (true);
create policy "pgcs delete" on fin_transactions for delete using (true);
-- app_state: no delete policy => DELETE is denied for the anon key.

-- Storage bucket policies are unchanged (see supabase-setup.sql part 7).

-- =====================================================================
-- PHASE 2 (NOT executed — requires moving login to Supabase Auth; see README-SYNC.md)
--   create table profiles(user_id uuid primary key references auth.users, mid text unique, role text check (role in ('adminIT','admin','member')));
--   create function app_role() returns text language sql stable as $f$ select role from profiles where user_id = auth.uid() $f$;
--   -- then: drop the anon policies above and add e.g.
--   --   create policy fin_write on fin_transactions for all to authenticated
--   --     using (app_role() in ('adminIT','admin')) with check (app_role() in ('adminIT','admin'));
--   --   same for storage.objects bucket 'fin-docs'; members get read-only on payments/own rows.
-- =====================================================================
