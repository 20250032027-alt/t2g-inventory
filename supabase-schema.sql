-- Run this in Supabase > SQL Editor

-- Products
create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text not null default 'bags',
  description text,
  created_at timestamptz default now()
);

-- Production entries
create table production_entries (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id) on delete cascade,
  quantity numeric not null,
  date date not null,
  batch_notes text,
  created_at timestamptz default now()
);

-- Sales entries
create table sales_entries (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id) on delete cascade,
  quantity numeric not null,
  date date not null,
  channel text not null default 'Direct',
  notes text,
  created_at timestamptz default now()
);

-- Row Level Security: allow authenticated users full access
alter table products enable row level security;
alter table production_entries enable row level security;
alter table sales_entries enable row level security;

create policy "auth users can do all on products"
  on products for all to authenticated using (true) with check (true);

create policy "auth users can do all on production_entries"
  on production_entries for all to authenticated using (true) with check (true);

create policy "auth users can do all on sales_entries"
  on sales_entries for all to authenticated using (true) with check (true);
