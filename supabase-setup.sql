-- =====================================================================
-- PGCS-21 — Supabase Database Setup Script
-- এই SQL গুলো Supabase SQL Editor-এ Run করুন
-- =====================================================================

-- 1️⃣ app_state table (সদস্য, সেটিংস, পাসওয়ার্ড ইত্যাদি key → JSON value হিসেবে সেভ)
create table if not exists app_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- 2️⃣ payments table (প্রতিটি Payment আলাদা row, এককভাবে অনুসন্ধান ও সংশোধনের জন্য)
create table if not exists payments (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- 3️⃣ RLS (Row Level Security) enable করুন — সবাই read/write করতে পারবে (anon key দিয়ে)
alter table app_state enable row level security;
alter table payments enable row level security;

-- 4️⃣ Policy: সবাই সব কিছু করতে পারবে (এই app-এর জন্য password ভিত্তিক access control আছে)
drop policy if exists "Allow all operations for anon users" on app_state;
drop policy if exists "Allow all operations for anon users" on payments;

create policy "Allow all operations for anon users"
  on app_state for all
  using (true)
  with check (true);

create policy "Allow all operations for anon users on payments"
  on payments for all
  using (true)
  with check (true);

-- 5️⃣ Index তৈরি করুন (দ্রুত query-র জন্য)
create index if not exists app_state_key_idx on app_state(key);
create index if not exists payments_id_idx on payments(id);
create index if not exists payments_updated_at_idx on payments(updated_at);

-- =====================================================================
-- 6️⃣ Financial Statement module (নতুন) — আগের কোনো table/data বদলায় না
-- =====================================================================
create table if not exists fin_transactions (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table fin_transactions enable row level security;
drop policy if exists "Allow all operations for anon users on fin_transactions" on fin_transactions;
create policy "Allow all operations for anon users on fin_transactions"
  on fin_transactions for all using (true) with check (true);
create index if not exists fin_transactions_updated_at_idx on fin_transactions(updated_at);

-- 7️⃣ Supporting documents-এর জন্য Private Storage Bucket (সর্বোচ্চ 10 MB, নির্দিষ্ট file type)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fin-docs', 'fin-docs', false, 10485760, array[
  'application/pdf','image/jpeg','image/png','application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, public = false;

drop policy if exists "fin-docs select" on storage.objects;
drop policy if exists "fin-docs insert" on storage.objects;
drop policy if exists "fin-docs delete" on storage.objects;
create policy "fin-docs select" on storage.objects for select using (bucket_id = 'fin-docs');
create policy "fin-docs insert" on storage.objects for insert with check (bucket_id = 'fin-docs');
create policy "fin-docs delete" on storage.objects for delete using (bucket_id = 'fin-docs');

-- ✅ সম্পন্ন! এখন আপনার PGCS-21 app database-এর সাথে connect হতে পারবে।
