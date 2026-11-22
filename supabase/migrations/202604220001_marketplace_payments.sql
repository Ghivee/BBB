create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text not null,
    full_name text not null,
    campus text not null default '',
    phone text not null default '',
    student_id_last4 text not null default '',
    entry_year integer,
    avatar_url text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'profiles' and column_name = 'name'
    ) and not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'profiles' and column_name = 'full_name'
    ) then
        alter table public.profiles rename column name to full_name;
    end if;
end;
$$;

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists phone text not null default '';
alter table public.profiles add column if not exists student_id_last4 text not null default '';
alter table public.profiles add column if not exists entry_year integer;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

create table if not exists public.products (
    id uuid primary key default gen_random_uuid(),
    seller_id uuid not null references public.profiles(id) on delete cascade,
    title text not null check (char_length(title) between 3 and 80),
    category text not null check (category in ('buku', 'elektronik', 'kost', 'pakaian', 'lainnya')),
    price bigint not null check (price between 1000 and 1000000000),
    condition text not null check (condition in ('baru', 'bekas-seperti-baru', 'bekas-pakai')),
    location_code text not null check (location_code in ('untidar', 'unimma', 'akmil', 'pusat_kota')),
    description text not null default '',
    photos text[] not null check (cardinality(photos) between 1 and 5),
    status text not null default 'active' check (status in ('active', 'sold')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'products' and column_name = 'location'
    ) and not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'products' and column_name = 'location_code'
    ) then
        alter table public.products rename column location to location_code;
    end if;
end;
$$;

alter table public.products add column if not exists condition text not null default 'bekas-seperti-baru';
alter table public.products add column if not exists location_code text not null default 'untidar';
alter table public.products add column if not exists status text not null default 'active';
alter table public.products add column if not exists created_at timestamptz not null default now();
alter table public.products add column if not exists updated_at timestamptz not null default now();

update public.profiles p
set full_name = coalesce(nullif(p.full_name, ''), 'Mahasiswa BBB.id')
where p.full_name is null or p.full_name = '';

update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id and (p.email is null or p.email = '');

update public.products
set location_code = case
    when lower(location_code) like '%unimma%' or lower(location_code) like '%muhammadiyah%' then 'unimma'
    when lower(location_code) like '%akmil%' or lower(location_code) like '%akademi milit%' then 'akmil'
    when lower(location_code) like '%alun%' or lower(location_code) like '%pusat kota%' then 'pusat_kota'
    else 'untidar'
end;

create table if not exists public.orders (
    id uuid primary key default gen_random_uuid(),
    product_id uuid not null references public.products(id),
    buyer_id uuid not null references public.profiles(id),
    seller_id uuid not null references public.profiles(id),
    fulfillment text not null check (fulfillment in ('meetup', 'delivery')),
    payment_method text not null default 'cod' check (payment_method in ('cod', 'online')),
    meeting_point text not null check (char_length(meeting_point) between 3 and 120),
    item_amount bigint not null check (item_amount > 0),
    delivery_fee bigint not null default 0 check (delivery_fee >= 0),
    total_amount bigint generated always as (item_amount + delivery_fee) stored,
    order_status text not null default 'awaiting-seller'
        check (order_status in ('awaiting-seller', 'confirmed', 'ready', 'completed', 'cancelled')),
    payment_status text not null default 'unpaid'
        check (payment_status in ('unpaid', 'pending', 'paid')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.payments (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.orders(id),
    provider text not null check (provider = 'yobasepay'),
    provider_trx_id text unique,
    requested_amount bigint not null check (requested_amount > 0),
    amount bigint not null check (amount > 0),
    payment_url text,
    status text not null default 'PENDING' check (status in ('CREATING', 'PENDING', 'SUCCESS', 'EXPIRED', 'CANCELLED', 'FAILED')),
    expired_at timestamptz,
    paid_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists products_status_created_idx on public.products(status, created_at desc);
create index if not exists products_seller_idx on public.products(seller_id, created_at desc);
create index if not exists orders_buyer_idx on public.orders(buyer_id, created_at desc);
create index if not exists orders_seller_idx on public.orders(seller_id, created_at desc);
create index if not exists payments_order_idx on public.payments(order_id, created_at desc);
create unique index if not exists one_open_payment_per_order
    on public.payments(order_id)
    where status in ('CREATING', 'PENDING');
create unique index if not exists one_open_order_per_product
    on public.orders(product_id)
    where order_status in ('awaiting-seller', 'confirmed', 'ready');

create or replace function public.mark_product_sold_after_order_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.order_status = 'completed' and old.order_status <> 'completed' then
        update public.products set status = 'sold', updated_at = now() where id = new.product_id;
    end if;
    return new;
end;
$$;

create or replace function public.reject_order_for_unavailable_product()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    current_status text;
begin
    select status into current_status
    from public.products
    where id = new.product_id
    for update;
    if current_status is distinct from 'active' then
        raise exception 'Product is not available for order'
            using errcode = '23514';
    end if;
    return new;
end;
$$;

drop trigger if exists new_order_requires_active_product on public.orders;
create trigger new_order_requires_active_product
before insert on public.orders
for each row execute function public.reject_order_for_unavailable_product();

drop trigger if exists order_completion_marks_product_sold on public.orders;
create trigger order_completion_marks_product_sold
after update of order_status on public.orders
for each row execute function public.mark_product_sold_after_order_completion();

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.payments enable row level security;

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Product image owners can upload" on storage.objects;
create policy "Product image owners can upload"
on storage.objects for insert to authenticated
with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Product image owners can update" on storage.objects;
create policy "Product image owners can update"
on storage.objects for update to authenticated
using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Product image owners can delete" on storage.objects;
create policy "Product image owners can delete"
on storage.objects for delete to authenticated
using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = auth.uid()::text
);
