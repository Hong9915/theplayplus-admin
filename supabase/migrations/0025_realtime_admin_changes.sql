-- 관리자 화면 실시간 갱신.
-- 문의·답변/회신·메모·라운지 항목이 바뀌면 DB 트리거가 Supabase Realtime의
-- `admin:changes` 채널(private)로 "무슨 표가 어떻게 바뀌었다"만 Broadcast한다.
-- 브라우저(components/layout/RealtimeRefresh.tsx)는 그 신호를 받아 서버 렌더를
-- 다시 돌린다. 표 내용은 실리지 않으므로 표의 RLS는 그대로(정책 없음)다.
-- 재실행 안전.

create or replace function notify_admin_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- realtime.send는 실패를 warning으로 삼키지만, 혹시 함수가 없는 환경이어도
  -- 원래 쓰기(문의 접수 등)를 막지 않게 한 번 더 감싼다.
  begin
    perform realtime.send(
      jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP),
      'change',
      'admin:changes',
      true
    );
  exception when others then
    raise warning 'notify_admin_change: %', sqlerrm;
  end;
  return null;
end;
$$;

-- 새 문의. 수정은 화면에 보이는 열이 바뀔 때만 — draft_reply(초안 자동 저장,
-- 2초마다)·embedding·translations 같은 열 갱신은 신호를 내지 않는다.
drop trigger if exists inquiries_notify_admin_insert on inquiries;
create trigger inquiries_notify_admin_insert
  after insert on inquiries
  for each row execute function notify_admin_change();

drop trigger if exists inquiries_notify_admin_update on inquiries;
create trigger inquiries_notify_admin_update
  after update on inquiries
  for each row
  when (
    old.status is distinct from new.status
    or old.priority is distinct from new.priority
    or old.unread_reply_at is distinct from new.unread_reply_at
    or old.replied_at is distinct from new.replied_at
    or old.game_id is distinct from new.game_id
  )
  execute function notify_admin_change();

-- 보낸 답변·자동 답변·사용자 회신.
drop trigger if exists inquiry_messages_notify_admin on inquiry_messages;
create trigger inquiry_messages_notify_admin
  after insert on inquiry_messages
  for each row execute function notify_admin_change();

-- 내부 메모(다른 관리자가 쓴 메모가 대화 열에 바로 보이게).
drop trigger if exists inquiry_notes_notify_admin on inquiry_notes;
create trigger inquiry_notes_notify_admin
  after insert on inquiry_notes
  for each row execute function notify_admin_change();

-- 네이버 라운지 새 글·댓글과 읽음 처리.
drop trigger if exists lounge_items_notify_admin on lounge_items;
create trigger lounge_items_notify_admin
  after insert or update of read_at on lounge_items
  for each row execute function notify_admin_change();

-- 로그인한 관리자만 채널을 구독할 수 있다. private 채널은 realtime.messages의
-- select 정책이 있어야 구독이 허용된다. anon은 정책이 없어 막힌다.
drop policy if exists "admins subscribe admin:changes" on realtime.messages;
create policy "admins subscribe admin:changes"
  on realtime.messages
  for select
  to authenticated
  using (realtime.topic() = 'admin:changes' and extension = 'broadcast');
