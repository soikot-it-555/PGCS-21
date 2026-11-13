-- PGCS-21 : Supabase → SQL Editor-এ পুরোটা পেস্ট করে একবার Run করুন

-- সদস্য, সেটিংস, পাসওয়ার্ড ইত্যাদি (key → JSON)
create table if not exists app_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- প্রতিটি Payment আলাদা row (একসাথে অনেকে Entry দিলেও একটি আরেকটিকে মুছবে না)
create table if not exists payments (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table app_state enable row level security;
alter table payments  enable row level security;

-- বর্তমান Login সিস্টেম ঠিক রাখার জন্য ওয়েবসাইটকে read/write অনুমতি
-- (পরবর্তী ধাপে Supabase Auth দিয়ে এটি কঠোর করা যাবে)
drop policy if exists "site access app_state" on app_state;
drop policy if exists "site access payments"  on payments;
create policy "site access app_state" on app_state for all to anon, authenticated using (true) with check (true);
create policy "site access payments"  on payments  for all to anon, authenticated using (true) with check (true);
