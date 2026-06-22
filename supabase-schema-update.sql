-- Run this in Supabase > SQL Editor (for existing installs)
-- This adds the new columns and return_entries table

-- Add new columns to sales_entries
alter table sales_entries
  add column if not exists reference_no text,
  add column if not exists client text,
  add column if not exists payment_type text not null default 'Cash';

-- Returns / Bad Orders table
create table if not exists return_entries (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id) on delete cascade,
  quantity numeric not null,
  date date not null,
  reason text not null default 'Bad Order',
  restore_stock boolean not null default true,
  reference_no text,
  client text,
  notes text,
  created_at timestamptz default now()
);

alter table return_entries enable row level security;

create policy "auth users can do all on return_entries"
  on return_entries for all to authenticated using (true) with check (true);
