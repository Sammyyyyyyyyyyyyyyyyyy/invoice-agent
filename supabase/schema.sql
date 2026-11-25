-- Run this once in Supabase → SQL Editor → New query → Run.

create table if not exists vendors (
  id text primary key,
  name text not null,
  gstin text,
  bank_name text,
  bank_account text,
  ifsc text
);

create table if not exists purchase_orders (
  id text primary key,
  vendor_id text references vendors(id) on delete cascade,
  description text,
  amount numeric not null,          -- agreed value before tax
  invoiced numeric not null default 0  -- already billed and approved
);

create table if not exists runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  file_name text,
  vendor_id text,
  vendor_name text,
  invoice_number text,
  invoice_date text,
  po_number text,
  subtotal numeric,
  tax numeric,
  total numeric,
  decision text not null,           -- Approve | Review | Reject
  priority text not null default 'normal',
  tags text[] not null default '{}',
  reason text,
  variance numeric,
  within_tolerance boolean not null default false,
  stages jsonb,
  extracted jsonb,
  seeded boolean not null default false
);

-- The app talks to the database only from the server with the service key,
-- so lock the tables against public (browser) access.
alter table vendors enable row level security;
alter table purchase_orders enable row level security;
alter table runs enable row level security;
