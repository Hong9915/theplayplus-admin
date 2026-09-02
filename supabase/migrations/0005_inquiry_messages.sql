-- 답변 스레드(inquiry_messages)와 Gmail 스레드 연결(gmail_thread_id), 우선순위 정렬용 컬럼.
--
-- 지금까지 답변은 inquiries.reply_content 한 칸에만 저장돼 두 번째 답변이 첫
-- 번째를 덮어썼다. 답변을 메시지 단위로 쌓고, 사용자가 메일로 회신한 내용도
-- 같은 표에 inbound로 넣어 문의 하나가 온전한 대화 기록이 되게 한다.
--
-- reply_content / replied_at은 "마지막 답변"으로 계속 갱신한다. 추천 기능이
-- 과거 답변 예시로 읽고, contact 저장소 쪽에서도 참조할 수 있어서다.
--
-- RLS를 켜고 정책은 두지 않는다 — service-role만 접근한다.

alter table inquiries add column if not exists gmail_thread_id text;

-- priority는 text라 그대로 order by 하면 알파벳순(high, low, normal, urgent)이
-- 된다. 정렬용 순위를 생성 컬럼으로 둔다.
alter table inquiries add column if not exists priority_rank int
  generated always as (
    case priority
      when 'urgent' then 0
      when 'high'   then 1
      when 'normal' then 2
      else 3
    end
  ) stored;

create table if not exists inquiry_messages (
  id               uuid primary key default gen_random_uuid(),
  inquiry_id       uuid not null references inquiries(id) on delete cascade,
  direction        text not null check (direction in ('outbound', 'inbound')),
  -- outbound: 보낸 관리자 이메일, inbound: 회신한 사용자 주소
  author_email     text,
  body             text not null,
  -- Gmail API의 message id. 회신을 동기화할 때 같은 메일을 두 번 넣지 않는 기준.
  gmail_message_id text,
  -- RFC 2822 Message-ID 헤더. 다음 답변의 In-Reply-To / References에 넣어
  -- Gmail이 같은 스레드로 묶게 한다.
  rfc_message_id   text,
  sent_at          timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

create unique index if not exists inquiry_messages_gmail_message_id_key
  on inquiry_messages (gmail_message_id) where gmail_message_id is not null;
create index if not exists inquiry_messages_inquiry_id_idx
  on inquiry_messages (inquiry_id, sent_at);

alter table inquiry_messages enable row level security;

-- 이미 보낸 답변을 스레드의 첫 메시지로 옮긴다. 두 번 실행해도 중복되지 않는다.
insert into inquiry_messages (inquiry_id, direction, body, sent_at)
select i.id, 'outbound', i.reply_content, coalesce(i.replied_at, i.created_at)
from inquiries i
where i.reply_content is not null
  and not exists (select 1 from inquiry_messages m where m.inquiry_id = i.id);
