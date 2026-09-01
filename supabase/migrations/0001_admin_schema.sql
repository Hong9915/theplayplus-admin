create extension if not exists "pgcrypto";

create table if not exists games (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  status       text not null default 'active',
  logo_path    text,
  owner_name   text,
  created_at   timestamptz not null default now()
);

create table if not exists inquiry_groups (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references games(id) on delete cascade,
  key          text not null,
  label_ko     text not null,
  label_zh     text,
  label_en     text,
  sort_order   int not null default 0
);

create table if not exists inquiry_types (
  id                      uuid primary key default gen_random_uuid(),
  group_id                uuid not null references inquiry_groups(id) on delete cascade,
  key                     text not null,
  label_ko                text not null,
  label_zh                text,
  label_en                text,
  requires_game_account   boolean not null default false,
  requires_company_name   boolean not null default false,
  allow_attachments       boolean not null default false,
  sort_order              int not null default 0
);

-- inquiries/inquiry_attachments may already exist from theplayplus-contact's
-- own migration. Create them if this repo's migration runs first, then
-- backfill the columns this repo needs either way.
create table if not exists inquiries (
  id             uuid primary key default gen_random_uuid(),
  game_id        uuid references games(id),
  locale         text not null default 'ko',
  group_key      text not null,
  type_key       text not null,
  game_account   text,
  company_name   text,
  reply_email    text not null,
  title          text not null,
  content        text not null,
  status         text not null default 'new',
  reply_content  text,
  replied_at     timestamptz,
  meta           jsonb not null default '{}',
  created_at     timestamptz not null default now()
);

alter table inquiries add column if not exists game_id uuid references games(id);
alter table inquiries add column if not exists reply_content text;
alter table inquiries add column if not exists replied_at timestamptz;

create table if not exists inquiry_attachments (
  id             uuid primary key default gen_random_uuid(),
  inquiry_id     uuid not null references inquiries(id) on delete cascade,
  file_path      text not null,
  file_name      text not null,
  created_at     timestamptz not null default now()
);

-- RLS: anon (used by theplayplus-contact) may read active games and all
-- categories, and insert inquiries/attachments. Everything else is
-- accessed only by this repo's service-role client, which bypasses RLS.
alter table games enable row level security;
alter table inquiry_groups enable row level security;
alter table inquiry_types enable row level security;
alter table inquiries enable row level security;
alter table inquiry_attachments enable row level security;

-- create policy has no "if not exists" form, so every policy is dropped
-- first to keep this migration safe to re-run and to avoid a name
-- collision with theplayplus-contact's own migration aborting the
-- transaction (which would silently revert the RLS enables above too).
drop policy if exists "Public read active games" on games;
create policy "Public read active games" on games for select to anon using (status = 'active');

drop policy if exists "Public read inquiry_groups" on inquiry_groups;
create policy "Public read inquiry_groups" on inquiry_groups for select to anon using (true);

drop policy if exists "Public read inquiry_types" on inquiry_types;
create policy "Public read inquiry_types" on inquiry_types for select to anon using (true);

drop policy if exists "Allow public insert on inquiries" on inquiries;
create policy "Allow public insert on inquiries"
  on inquiries for insert
  to anon
  with check (true);

drop policy if exists "Allow public insert on inquiry_attachments" on inquiry_attachments;
create policy "Allow public insert on inquiry_attachments"
  on inquiry_attachments for insert
  to anon
  with check (true);

insert into storage.buckets (id, name, public)
values ('game-logos', 'game-logos', true)
on conflict (id) do nothing;

drop policy if exists "Public read game logos" on storage.objects;
create policy "Public read game logos" on storage.objects for select
  using (bucket_id = 'game-logos');
