-- 내부 메모(inquiry_notes), 변경 이력(inquiry_events), 답변 초안(draft_reply).
--
-- 1단계의 inquiry_number_seq와 달리 이 테이블들에는 트리거가 붙지 않는다.
-- 관리자 앱의 service-role 클라이언트만 읽고 쓰므로 security definer 함수도
-- 필요 없다. RLS를 켜고 정책을 두지 않으면 anon/authenticated는 전면 차단된다.

alter table inquiries add column if not exists draft_reply text;

create table if not exists inquiry_notes (
  id           uuid primary key default gen_random_uuid(),
  inquiry_id   uuid not null references inquiries(id) on delete cascade,
  author_id    uuid,
  author_email text not null,
  content      text not null,
  created_at   timestamptz not null default now()
);

-- actor_id/author_id에 FK를 걸지 않는 이유: 감사 기록은 계정이 삭제된 뒤에도
-- 누가 처리했는지가 남아야 한다. 이메일을 비정규화해 저장하는 이유도 같다.
create table if not exists inquiry_events (
  id           uuid primary key default gen_random_uuid(),
  inquiry_id   uuid not null references inquiries(id) on delete cascade,
  actor_id     uuid,
  actor_email  text not null,
  kind         text not null,
  from_value   text,
  to_value     text,
  created_at   timestamptz not null default now()
);

create index if not exists inquiry_notes_inquiry_id_idx  on inquiry_notes (inquiry_id, created_at);
create index if not exists inquiry_events_inquiry_id_idx on inquiry_events (inquiry_id, created_at);

alter table inquiry_notes  enable row level security;
alter table inquiry_events enable row level security;
