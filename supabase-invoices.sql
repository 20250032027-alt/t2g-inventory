-- Run this in Supabase SQL Editor

-- Invoices table (groups multiple line items)
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  reference_no text,
  client text,
  date date not null,
  channel text not null default 'Direct',
  payment_type text not null default 'Cash',
  notes text,
  created_at timestamptz default now()
);

alter table invoices enable row level security;
create policy "auth users can do all on invoices"
  on invoices for all to authenticated using (true) with check (true);

-- Invoice line items
create table if not exists invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references invoices(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  quantity numeric not null,
  created_at timestamptz default now()
);

alter table invoice_items enable row level security;
create policy "auth users can do all on invoice_items"
  on invoice_items for all to authenticated using (true) with check (true);
