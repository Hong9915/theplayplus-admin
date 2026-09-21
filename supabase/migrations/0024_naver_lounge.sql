-- 네이버 게임 라운지 새 글·댓글 알림.
-- 설계: docs/superpowers/specs/2026-09-21-naver-lounge-alerts-design.md
-- 재실행 안전. Vault의 inquiry_webhook_secret은 자동 답변 설정 때 넣은 것을 그대로 쓴다.

alter table games add column if not exists naver_lounge_id text;
alter table games add column if not exists lounge_synced_at timestamptz;

create table if not exists lounge_items (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  kind text not null check (kind in ('post', 'comment')),
  naver_id bigint not null,
  feed_id bigint not null,
  title text not null,
  body text not null default '',
  board_name text,
  nickname text,
  is_user boolean not null,
  url text not null,
  comment_count integer,
  posted_at timestamptz not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (game_id, kind, naver_id)
);

create index if not exists lounge_items_unread_idx on lounge_items (game_id) where read_at is null;
create index if not exists lounge_items_game_posted_idx on lounge_items (game_id, posted_at desc);

-- 정책 없음: service_role만 읽고 쓴다.
alter table lounge_items enable row level security;

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('lounge-sync-run')
  where exists (select 1 from cron.job where jobname = 'lounge-sync-run');

select cron.schedule(
  'lounge-sync-run',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://admin.theplayplus.com/api/lounge/sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'inquiry_webhook_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
