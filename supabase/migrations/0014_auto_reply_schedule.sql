-- 자동 답변 지연 발송.
--
-- 접수 직후 자동 답변이 나가면 기계가 보낸 티가 난다. 대신 접수 시 DB 트리거가
-- inquiries.auto_reply_due_at을 30분~1시간 뒤 랜덤으로 채우고, pg_cron이 매분
-- (지연 범위는 0016에서 5분~30분으로 바꿨다.)
-- /api/auto-reply/run 을 호출해 그 시각이 지난 건만 보낸다.
--
-- 이전 방식(inquiries INSERT 웹훅 → /api/auto-reply/inquiry 즉시 발송)은
-- 제거했다. Supabase 대시보드의 그 웹훅도 지워야 한다 (CLAUDE.md 참고).
--
-- 트리거로 하는 이유: 우선순위(0009)와 같다. 접수 폼은 이 저장소의 API를
-- 거치지 않고 inquiries에 직접 insert한다.

alter table inquiries
  add column if not exists auto_reply_due_at timestamptz;

-- 매분 "예정 시각이 지난 건"만 찾으므로 부분 인덱스로 충분하다.
create index if not exists inquiries_auto_reply_due_idx
  on inquiries (auto_reply_due_at)
  where auto_reply_due_at is not null;

-- 접수 시 예정 시각을 정한다. 그 게임에 자동 발송 템플릿이 하나도 없으면
-- 예약하지 않는다. 유형 매칭(유형 전용 → 공용)은 발송 시점에 앱이 다시 한다.
-- insert에 auto_reply_due_at을 명시하면 그 값을 그대로 쓴다.
create or replace function assign_auto_reply_due() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if new.auto_reply_due_at is not null then
    return new;
  end if;

  if new.game_id is not null and exists (
    select 1 from public.reply_templates t
    where t.game_id = new.game_id and t.auto_send
  ) then
    -- 30분 + 0~30분 랜덤 = 30분~1시간 뒤.
    new.auto_reply_due_at := now() + interval '30 minutes' + (random() * interval '30 minutes');
  end if;

  return new;
end $$;

drop trigger if exists inquiries_assign_auto_reply_due on inquiries;
create trigger inquiries_assign_auto_reply_due
  before insert on inquiries
  for each row execute function assign_auto_reply_due();

-- 예정 시각이 지난 문의를 가져오면서 예정을 지운다. 한 문장으로 하므로
-- 매분 호출이 겹쳐도(앞 호출이 1분 넘게 걸린 경우) 같은 건을 두 번 주지 않는다.
-- skip locked: 다른 트랜잭션이 잡은 행은 건너뛴다.
-- 돌려주는 컬럼은 lib/send-reply.ts REPLYABLE_INQUIRY_COLUMNS와 같다.
create or replace function claim_due_auto_replies(p_limit int)
returns table (
  id uuid,
  game_id uuid,
  group_key text,
  type_key text,
  game_account text,
  reply_email text,
  title text,
  content text,
  inquiry_no text,
  gmail_thread_id text
)
language sql
volatile
as $$
  with due as (
    select i.id
    from inquiries i
    where i.auto_reply_due_at is not null
      and i.auto_reply_due_at <= now()
    order by i.auto_reply_due_at
    limit p_limit
    for update skip locked
  )
  update inquiries i
  set auto_reply_due_at = null
  from due
  where i.id = due.id
  returning i.id, i.game_id, i.group_key, i.type_key, i.game_account,
            i.reply_email, i.title, i.content, i.inquiry_no, i.gmail_thread_id
$$;

-- 관리자 앱은 service-role 클라이언트로 호출한다. 접수 폼(anon)에는 열지 않는다.
revoke execute on function claim_due_auto_replies(int) from public, anon, authenticated;
grant execute on function claim_due_auto_replies(int) to service_role;

-- 매분 발송 라우트를 부른다. 비밀값은 코드에 두지 않고 Vault에서 읽는다.
-- 이 부분을 실행하기 전에 SQL Editor에서 먼저 한 번만:
--   select vault.create_secret('<INQUIRY_WEBHOOK_SECRET 값>', 'inquiry_webhook_secret');
-- 관리자 도메인이 다르면 아래 url을 바꾼다.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('auto-reply-run')
  where exists (select 1 from cron.job where jobname = 'auto-reply-run');

select cron.schedule(
  'auto-reply-run',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://admin.theplayplus.com/api/auto-reply/run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'inquiry_webhook_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
