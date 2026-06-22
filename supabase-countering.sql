-- Run this in Supabase SQL Editor

-- Counter entry header (links to a consign invoice)
create table if not exists counter_entries (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references invoices(id) on delete cascade,
  date date not null,
  notes text,
  created_at timestamptz default now()
);

alter table counter_entries enable row level security;
create policy "auth users can do all on counter_entries"
  on counter_entries for all to authenticated using (true) with check (true);

-- Counter line items (what was sold per product in this counter)
create table if not exists counter_items (
  id uuid primary key default gen_random_uuid(),
  counter_entry_id uuid references counter_entries(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  quantity numeric not null,
  created_at timestamptz default now()
);

alter table counter_items enable row level security;
create policy "auth users can do all on counter_items"
  on counter_items for all to authenticated using (true) with check (true);
