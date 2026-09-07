-- 사용자 회신 자동 동기화.
--
-- 관리자가 "회신 확인" 버튼을 누르지 않아도 pg_cron이 5분마다
-- /api/replies/sync 를 호출해 발신 메일함(help@, info@)에서 새로 받은 메일을
-- 문의 스레드에 맞춰 inquiry_messages 에 넣는다. 새 회신이 들어온 문의는
-- unread_reply_at 이 채워져 목록에 "회신 옴"으로 보이고, 관리자가 열어 보거나
-- 답변을 보내면 비워진다. 설계: docs/superpowers/specs/2026-09-07-reply-sync-design.md
--
-- 재실행 안전. 0014와 같은 Vault 비밀값(inquiry_webhook_secret)을 쓴다.

-- 1. 읽지 않은 회신 표시
alter table inquiries
  add column if not exists unread_reply_at timestamptz;

-- 문의함 보기의 "회신 도착" 건수와 목록 필터는 값이 있는 행만 본다.
create index if not exists inquiries_unread_reply_idx
  on inquiries (game_id)
  where unread_reply_at is not null;

-- 2. 메일함별 마지막 확인 시각. 앱(service_role)만 읽고 쓴다.
create table if not exists gmail_sync_state (
  mailbox        text primary key,          -- 'game' | 'service' (lib/gmail.ts의 Mailbox)
  synced_through timestamptz not null,
  updated_at     timestamptz not null default now()
);
alter table gmail_sync_state enable row level security;

-- 3. 문의함 보기 건수에 unread 항목 추가. 0012의 본문에 한 줄을 더한 것.
create or replace function inquiry_facet_counts(p_game_id uuid)
returns table (facet text, key text, count bigint)
language sql
stable
as $$
  with scoped as (
    select status, type_key, priority, created_at, unread_reply_at
    from inquiries
    where game_id = p_game_id
       or (p_game_id is null and game_id is null)
  )
  select 'status'::text, status::text, count(*) from scoped group by status
  union all
  select 'type', type_key, count(*) from scoped group by type_key
  union all
  select 'priority', coalesce(priority, 'normal'), count(*) from scoped group by 2
  union all
  select 'stale', '1', count(*) from scoped
    where status <> 'resolved' and created_at < now() - interval '72 hours'
  union all
  select 'unread', '1', count(*) from scoped
    where unread_reply_at is not null
  union all
  select 'total', 'all', count(*) from scoped
$$;

revoke execute on function inquiry_facet_counts(uuid) from public, anon, authenticated;
grant execute on function inquiry_facet_counts(uuid) to service_role;

-- 4. 5분마다 동기화 호출. 도메인이 다르면 url을 바꿔 실행한다.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('reply-sync-run')
  where exists (select 1 from cron.job where jobname = 'reply-sync-run');

select cron.schedule(
  'reply-sync-run',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://admin.theplayplus.com/api/replies/sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'inquiry_webhook_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
