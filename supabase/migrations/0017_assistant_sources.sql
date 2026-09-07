-- 운영 어시스턴트 자료 연결: 게임마다 구글 시트·문서를 여러 개 붙인다. games.sheet_id를 대체한다.

create table if not exists assistant_sources (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references games(id) on delete cascade,
  kind         text not null check (kind in ('sheet', 'doc')),
  external_id  text not null,
  title        text not null,
  created_at   timestamptz not null default now(),
  unique (game_id, kind, external_id)
);
create index if not exists assistant_sources_game_idx on assistant_sources (game_id, created_at);

-- 관리자 앱은 service role로 접근한다. anon(접수 폼)은 볼 이유가 없다.
alter table assistant_sources enable row level security;

-- 기존 시트 연결을 옮긴다. 실제 제목은 모르므로 '운영 시트'로 두고, 화면에서 해제 후 다시 등록하면 실제 제목이 들어간다.
insert into assistant_sources (game_id, kind, external_id, title)
select id, 'sheet', sheet_id, '운영 시트' from games where sheet_id is not null
on conflict do nothing;

alter table games drop column if exists sheet_id;
