-- AI 답변 추천의 운영정책 근거.
--
-- 웹사이트 게임 페이지의 운영정책 주소(game_pages.policy_url, 0031)는 네이버 라운지 글이다.
-- 그 글이 속한 게시판(이용약관·환불 정책·라운지 운영 정책 등)을 pg_cron이 매시간
-- /api/policies/sync로 읽어, 글을 조각(청크)으로 나눠 text-embedding-3-small(1536차원)로
-- 임베딩해 둔다. 추천은 문의 임베딩(0021)과 가까운 조각을 같은 게임 안에서 찾는다.
--
-- content_hash는 글(제목+본문) 전체의 해시라 한 글의 조각은 모두 같은 값이다. 동기화는
-- 해시와 embedding_model이 같으면 그 글을 건너뛰므로, 글이 바뀌지 않으면 OpenAI를 부르지 않는다.
--
-- 재실행 안전. Vault의 inquiry_webhook_secret은 자동 답변 설정 때 넣은 것을 그대로 쓴다.

create extension if not exists vector with schema extensions;

create table if not exists policy_chunks (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  feed_id bigint not null,
  chunk_index int not null,
  title text not null,
  content text not null,
  url text not null,
  content_hash text not null,
  embedding extensions.vector(1536) not null,
  embedding_model text not null,
  posted_at timestamptz not null,
  updated_at timestamptz not null default now(),
  unique (game_id, feed_id, chunk_index)
);

create index if not exists policy_chunks_embedding_idx
  on policy_chunks using hnsw (embedding extensions.vector_cosine_ops);

-- 정책 없음: service_role만 읽고 쓴다.
alter table policy_chunks enable row level security;

create or replace function match_policy_chunks(
  p_game_id uuid,
  p_query extensions.vector(1536),
  p_limit int default 5,
  p_min_similarity float default 0.3
) returns table (
  feed_id bigint,
  chunk_index int,
  title text,
  content text,
  url text,
  similarity float
)
language sql
stable
as $$
  select ranked.feed_id, ranked.chunk_index, ranked.title, ranked.content, ranked.url, ranked.similarity
  from (
    select c.feed_id, c.chunk_index, c.title, c.content, c.url, 1 - (c.embedding <=> p_query) as similarity
    from policy_chunks c
    where c.game_id = p_game_id
    order by c.embedding <=> p_query
    limit p_limit
  ) ranked
  where ranked.similarity >= p_min_similarity
  order by ranked.similarity desc;
$$;

-- 0021과 같은 이유: HNSW는 후보를 고른 뒤 game_id로 거르므로 후보 폭을 넓힌다.
alter function match_policy_chunks(uuid, extensions.vector, int, float) set hnsw.ef_search = 200;

revoke execute on function match_policy_chunks(uuid, extensions.vector, int, float) from public, anon, authenticated;
grant execute on function match_policy_chunks(uuid, extensions.vector, int, float) to service_role;

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('policy-sync-run')
  where exists (select 1 from cron.job where jobname = 'policy-sync-run');

-- 정책 글은 자주 바뀌지 않고, 바뀌지 않은 글은 해시만 비교하므로 매시간이면 충분하다.
select cron.schedule(
  'policy-sync-run',
  '17 * * * *',
  $$
  select net.http_post(
    url := 'https://admin.theplayplus.com/api/policies/sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'inquiry_webhook_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
