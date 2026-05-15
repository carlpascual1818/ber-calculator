-- Asteral BER Calculator Supabase setup
-- Run this once inside Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  name text not null,
  cost_per_unit numeric not null default 0,
  currency text not null default 'USD',
  created_at timestamptz not null default now()
);

create table if not exists public.payment_processors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  name text not null,
  percent_fee numeric not null default 0,
  fixed_fee numeric not null default 0,
  fixed_fee_currency text not null default 'USD',
  conversion_fee_percent numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.markets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  name text not null,
  selling_currency text not null default 'GBP',
  payout_currency text not null default 'HKD',
  created_at timestamptz not null default now()
);

create table if not exists public.scenarios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  name text not null,
  supplier_id uuid,
  market_id uuid,
  display_currency text not null default 'USD',
  opex_percent numeric not null default 5.5,
  bundle_overrides jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.suppliers enable row level security;
alter table public.payment_processors enable row level security;
alter table public.markets enable row level security;
alter table public.scenarios enable row level security;

drop policy if exists suppliers_select_own on public.suppliers;
drop policy if exists suppliers_insert_own on public.suppliers;
drop policy if exists suppliers_update_own on public.suppliers;
drop policy if exists suppliers_delete_own on public.suppliers;
create policy suppliers_select_own on public.suppliers for select using (auth.uid() = user_id);
create policy suppliers_insert_own on public.suppliers for insert with check (auth.uid() = user_id);
create policy suppliers_update_own on public.suppliers for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy suppliers_delete_own on public.suppliers for delete using (auth.uid() = user_id);

drop policy if exists processors_select_own on public.payment_processors;
drop policy if exists processors_insert_own on public.payment_processors;
drop policy if exists processors_update_own on public.payment_processors;
drop policy if exists processors_delete_own on public.payment_processors;
create policy processors_select_own on public.payment_processors for select using (auth.uid() = user_id);
create policy processors_insert_own on public.payment_processors for insert with check (auth.uid() = user_id);
create policy processors_update_own on public.payment_processors for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy processors_delete_own on public.payment_processors for delete using (auth.uid() = user_id);

drop policy if exists markets_select_own on public.markets;
drop policy if exists markets_insert_own on public.markets;
drop policy if exists markets_update_own on public.markets;
drop policy if exists markets_delete_own on public.markets;
create policy markets_select_own on public.markets for select using (auth.uid() = user_id);
create policy markets_insert_own on public.markets for insert with check (auth.uid() = user_id);
create policy markets_update_own on public.markets for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy markets_delete_own on public.markets for delete using (auth.uid() = user_id);

drop policy if exists scenarios_select_own on public.scenarios;
drop policy if exists scenarios_insert_own on public.scenarios;
drop policy if exists scenarios_update_own on public.scenarios;
drop policy if exists scenarios_delete_own on public.scenarios;
create policy scenarios_select_own on public.scenarios for select using (auth.uid() = user_id);
create policy scenarios_insert_own on public.scenarios for insert with check (auth.uid() = user_id);
create policy scenarios_update_own on public.scenarios for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy scenarios_delete_own on public.scenarios for delete using (auth.uid() = user_id);
