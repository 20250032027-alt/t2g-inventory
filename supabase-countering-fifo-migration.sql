-- FIFO Countering Migration
-- Run this in Supabase SQL Editor

-- 1. Make invoice_id nullable on counter_entries (a FIFO entry can span multiple invoices)
alter table counter_entries alter column invoice_id drop not null;

-- 2. Add invoice_id to counter_items so each line knows which invoice it drew from
alter table counter_items add column if not exists invoice_id uuid references invoices(id) on delete cascade;

-- 3. Backfill existing counter_items with the invoice_id from their parent counter_entry
update counter_items ci
set invoice_id = ce.invoice_id
from counter_entries ce
where ci.counter_entry_id = ce.id
  and ci.invoice_id is null
  and ce.invoice_id is not null;
