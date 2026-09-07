-- AI 답변 추천의 유사 문의 검색.
--
-- 문의 제목+본문을 OpenAI text-embedding-3-small(1536차원)로 임베딩해 저장하고,
-- 새 문의와 코사인 거리가 가까운 "답변이 있는" 과거 문의를 같은 스코프(게임 하나
-- 또는 서비스 문의) 안에서 찾는다. 답변 본문은 첫 수동 답변이다 — 자동 발송
-- 매크로(auto_sent)는 근거가 못 되고, 뒤의 답변은 회신에 대한 것이라서다.
--
-- embedding_model은 어떤 모델로 만든 벡터인지 기록한다. 모델을 바꾸면 값이
-- 달라 코드가 그 문의만 다시 계산한다.
--
-- anon(접수 폼)은 열 단위 select 권한만 있어 새 열은 노출되지 않는다.

create extension if not exists vector with schema extensions;

alter table inquiries add column if not exists embedding extensions.vector(1536);
alter table inquiries add column if not exists embedding_model text;

create index if not exists inquiries_embedding_idx
  on inquiries using hnsw (embedding extensions.vector_cosine_ops);

create or replace function match_answered_inquiries(
  p_game_id uuid,
  p_query extensions.vector(1536),
  p_exclude_id uuid,
  p_limit int default 5,
  p_min_similarity float default 0.35
) returns table (
  id uuid,
  inquiry_no text,
  title text,
  content text,
  reply_body text,
  similarity float
)
language sql
stable
as $$
  select ranked.id, ranked.inquiry_no, ranked.title, ranked.content, ranked.reply_body, ranked.similarity
  from (
    select
      i.id,
      i.inquiry_no,
      i.title,
      i.content,
      coalesce(
        (
          select m.body
          from inquiry_messages m
          where m.inquiry_id = i.id
            and m.direction = 'outbound'
            and m.auto_sent = false
          order by m.sent_at
          limit 1
        ),
        i.reply_content
      ) as reply_body,
      1 - (i.embedding <=> p_query) as similarity
    from inquiries i
    where i.embedding is not null
      and i.reply_content is not null
      and i.id <> p_exclude_id
      and ((p_game_id is null and i.game_id is null) or i.game_id = p_game_id)
    order by i.embedding <=> p_query
    limit p_limit
  ) ranked
  where ranked.similarity >= p_min_similarity
  order by ranked.similarity desc;
$$;

-- HNSW는 상위 후보(ef_search, 기본 40)를 고른 뒤 game_id 조건을 거르므로 문의가 적은 게임은
-- 결과가 비기 쉽다. 후보 폭을 넓힌다. pgvector 0.8+면 hnsw.iterative_scan = relaxed_order도 검토.
alter function match_answered_inquiries(uuid, extensions.vector, uuid, int, float) set hnsw.ef_search = 200;

revoke execute on function match_answered_inquiries(uuid, extensions.vector, uuid, int, float) from public, anon, authenticated;
grant execute on function match_answered_inquiries(uuid, extensions.vector, uuid, int, float) to service_role;
