-- 웹사이트(theplayplus-web)의 게임 목록·상세 페이지를 관리자에서 채운다.
-- games 는 문의·CS 쪽이 쓰는 테이블이라 손대지 않고, 사이트 공개용 내용은
-- 게임당 한 행인 game_pages 에, 게임별 공지는 game_notices 에 둔다.
-- 웹은 CS 프로젝트의 service role 키로 읽으므로 anon 정책은 두지 않는다.

create table if not exists game_pages (
  game_id             uuid primary key references games(id) on delete cascade,
  -- 공개 스위치. 켜야 웹사이트 게임 목록·상세에 나온다.
  published           boolean not null default false,
  -- 웹 주소 /games/{slug}
  slug                text unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  release_status      text not null default 'upcoming' check (release_status in ('live', 'prereg', 'upcoming')),
  sort_order          int not null default 0,
  title_ko            text,
  title_zh            text,
  title_en            text,
  genre_ko            text,
  genre_zh            text,
  genre_en            text,
  tagline_ko          text,
  tagline_zh          text,
  tagline_en          text,
  -- 스토어 상품 설명 원문. 줄바꿈 그대로 보여준다.
  description_ko      text,
  description_zh      text,
  description_en      text,
  age_rating          text,
  developer           text,
  onestore_url        text,
  google_play_url     text,
  app_store_url       text,
  naver_lounge_url    text,
  youtube_id          text,
  probability_url     text,
  -- game-site 버킷 안의 경로. '/' 로 시작하면 웹사이트 public 폴더의 파일.
  kv_path             text,
  card_path           text,
  screenshot_paths    text[] not null default '{}',
  updated_at          timestamptz not null default now()
);

create table if not exists game_notices (
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid not null references games(id) on delete cascade,
  category      text not null default 'notice' check (category in ('notice', 'maintenance', 'update', 'event')),
  title         text not null,
  body          text not null,
  pinned        boolean not null default false,
  published_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists game_notices_game_published_idx
  on game_notices (game_id, pinned desc, published_at desc);

alter table game_pages enable row level security;
alter table game_notices enable row level security;

insert into storage.buckets (id, name, public)
values ('game-site', 'game-site', true)
on conflict (id) do nothing;

drop policy if exists "Public read game site images" on storage.objects;
create policy "Public read game site images" on storage.objects for select
  using (bucket_id = 'game-site');
