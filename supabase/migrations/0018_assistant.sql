-- 운영 시트 어시스턴트: 게임별 시트 연결 + 대화/메시지 저장.

alter table games add column if not exists sheet_id text;

create table if not exists assistant_conversations (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references games(id) on delete cascade,
  title       text not null,
  created_by  text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists assistant_conversations_game_updated_idx
  on assistant_conversations (game_id, updated_at desc);

create table if not exists assistant_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references assistant_conversations(id) on delete cascade,
  role             text not null check (role in ('user', 'assistant', 'proposal')),
  content          text not null default '',
  proposal         jsonb,
  status           text check (status in ('pending', 'applied', 'cancelled', 'failed')),
  failure_reason   text,
  applied_by       text,
  applied_at       timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists assistant_messages_conversation_idx
  on assistant_messages (conversation_id, created_at);

-- 관리자 앱은 service role로 접근한다. anon(접수 폼)은 이 표를 볼 이유가 없다.
alter table assistant_conversations enable row level security;
alter table assistant_messages enable row level security;

-- 접수 폼(anon)은 게임 목록만 필요하다. 시트 ID는 관리자만 본다.
revoke select on games from anon;
grant select (id, name, status, logo_path, owner_name, created_at) on games to anon;
