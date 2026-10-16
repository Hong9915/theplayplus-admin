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

-- 이미 서비스 중인 여신키우기는 지금 웹사이트에 하드코딩된 내용으로 채워 둔다.
-- 이미지는 웹사이트 public 폴더의 기존 파일을 가리킨다. 이름이 다르면 아무것도 넣지 않는다.
insert into game_pages (
  game_id, published, slug, release_status, sort_order,
  title_ko, title_zh, title_en, genre_ko, genre_zh, genre_en,
  tagline_ko, tagline_zh, tagline_en, description_ko,
  age_rating, developer, onestore_url, naver_lounge_url, youtube_id,
  kv_path, card_path, screenshot_paths
)
select
  g.id, true, 'goddess-idle', 'live', 0,
  '여신키우기: 방치형 RPG', '女神养成：放置RPG', 'Goddess Raising: Idle RPG',
  '방치형 RPG', '放置RPG', 'Idle RPG',
  '손을 떼도, 여신은 계속 강해진다.', '即使放下手机，女神也在继续变强。', 'Put the phone down. She keeps getting stronger.',
  E'접속 즉시 SSS+ 여신 [달기] 증정!\n+ 유저감사 특별 이벤트 증정!(라운지 각종 쿠폰)\n\n켜두기만 해도 폭풍 성장! 여신들과 즐기는 방치형 RPG\n\n이세계로 떠나는 새로운 모험, SSS 등급 여신을 끝없이 소환하세요!\n위기에 빠진 이세계를 구할 운명을 짊어지고, 매력 넘치는 여신들과 함께 어둠의 세력에 맞서 싸우세요!\n\n◆ 편안한 방치 플레이, 무리하지 않아도 강해진다!\n접속만 해도 보상 지급, 오프라인 상태에서도 레벨업은 계속!\n전투는 완전 자동! 스테이지 돌파부터 파밍, 레벨업까지 알아서 척척!\n하고 싶을 때 하고, 멈추고 싶을 때 멈추는 초자유 방치 플레이!\n\n◆ 끊이지 않는 SSS 등급 여신 소환, 육성 부담은 ZERO!\n초보자도 손쉽게 ALL 5성급 파티 완성 가능!\n희귀 등급 여신으로도 초반 육성 부담 걱정 없이 바로 활약!\n\n◆ 수십 명의 여신들, 소환할 때마다 짜릿한 손맛!\n각기 다른 개성과 스타일을 가진 여신들이 소환을 기다립니다.\n성급 돌파와 스킬 각성으로 전투력을 수직 상승시키세요!\n\n◆ 다양한 전투 모드, 전략으로 승부하라!\n1대1 전장부터 다수 대 다수 전장까지, 원하는 대로 선택!\n서로 다른 직업과 스킬 조합으로 최강의 파티를 완성하세요!\n\n◆ 자유로운 전직, 나만의 플레이 스타일 완성!\n근접 탱커부터 원거리 마법사까지, 다양한 캐릭터와 클래스!\n무궁무진한 스킬 조합으로 전략 파티 구성의 재미를 느껴보세요.\n\n◆ 길드와 마을, 부담 없는 소셜 라이프!\n길드에 가입해 원정과 자원 상호 지원 등 다양한 콘텐츠를 즐기고\n나만의 마을을 꾸미며 낚시와 농사로 이세계의 느긋한 일상까지 만끽하세요~',
  '15세 이용가', 'RunXuGame', 'https://onesto.re/0001007974',
  'https://game.naver.com/lounge/My_Goddess_Idle_RPG/home', 'Ky1PVk-TXu8',
  '/games/goddess-idle/kv-wide.png', '/games/goddess-idle/title-wide.webp',
  array[
    '/games/goddess-idle/screenshots/battle.webp',
    '/games/goddess-idle/screenshots/goddesses.webp',
    '/games/goddess-idle/screenshots/dungeon.webp',
    '/games/goddess-idle/screenshots/boss.webp',
    '/games/goddess-idle/screenshots/daily.webp'
  ]
from games g
where g.name like '여신키우기%'
order by g.created_at
limit 1
on conflict (game_id) do nothing;
