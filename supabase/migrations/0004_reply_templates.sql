-- 답변 템플릿. 게임별로 관리하고 type_key로 문의 유형에 선택적으로 연결한다.
--
-- type_key가 null이면 그 게임의 모든 유형에 쓰이는 공용 템플릿이다.
-- inquiry_types에 FK를 걸지 않는 이유: inquiry_types는 (group_id, key)로
-- 식별되고 inquiries 자신도 type_key를 문자열로만 들고 있다. 여기만 FK를
-- 거는 것은 일관성을 해친다.
--
-- RLS를 켜고 정책은 두지 않는다 — service-role만 접근하고 트리거가 없으니
-- 1단계의 inquiry_number_seq와 달리 security definer 함수도 필요 없다.

create table if not exists reply_templates (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references games(id) on delete cascade,
  type_key   text,
  title      text not null,
  content    text not null,
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists reply_templates_game_id_idx on reply_templates (game_id, sort_order, created_at);

alter table reply_templates enable row level security;
