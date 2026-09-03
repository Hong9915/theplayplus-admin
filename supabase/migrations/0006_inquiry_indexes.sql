-- inquiries 인덱스. 지금까지 이 테이블에는 인덱스가 하나도 없어서 목록·검색·
-- 배지 집계가 전부 풀스캔이었다. 쿼리는 그대로 두고 인덱스만 붙인다.
--
-- create index concurrently는 트랜잭션 안에서 못 돌아 일반 create index를
-- 쓴다. 현재 데이터량이면 잠금 시간은 무시해도 된다.

-- 목록 기본 경로. 모든 페이지가 game_id로 거르고 created_at으로 정렬한다
-- (lib/inquiries.ts applyFilters / applyOrder).
create index if not exists inquiries_game_created_idx
  on inquiries (game_id, created_at desc);

-- 우선순위순 정렬. priority_rank는 0005의 생성 컬럼(urgent=0 … low=3).
create index if not exists inquiries_game_priority_idx
  on inquiries (game_id, priority_rank, created_at desc);

-- 게임 레일 배지 (countNewInquiriesByGame). status='new'인 행만 담는 부분
-- 인덱스라 완료 문의가 쌓여도 크기가 안 자란다.
create index if not exists inquiries_new_by_game_idx
  on inquiries (game_id)
  where status = 'new';

-- 검색. 목록은 title / inquiry_no / game_account / content 4개 컬럼에
-- ILIKE '%q%'를 or()로 묶어 날린다. 트라이그램 GIN 인덱스는 이 ILIKE를
-- 쿼리 수정 없이 그대로 받는다.
--
-- Postgres 기본 전문검색(tsvector)을 쓰지 않는 이유: 한국어 형태소 분석기가
-- 없어 "환불이"와 "환불"이 다른 토큰이 되고, Supabase에 mecab을 올릴 수도
-- 없다. 트라이그램은 언어와 무관하게 3글자 조각으로 매칭한다.
--
-- 다중 컬럼 GIN 하나로 or() 조건을 한 번에 받는다. 검색어가 2글자 이하면
-- 트라이그램이 잘 안 잡혀 스캔으로 떨어지는데, 결과는 정확하고 지금과 같은
-- 속도라 퇴행은 아니다.
create extension if not exists pg_trgm;

create index if not exists inquiries_search_trgm_idx
  on inquiries using gin (
    title        gin_trgm_ops,
    content      gin_trgm_ops,
    game_account gin_trgm_ops,
    inquiry_no   gin_trgm_ops
  );

-- 적용 확인 (SQL 편집기에서 실행). Bitmap Index Scan on
-- inquiries_search_trgm_idx / inquiries_game_created_idx가 보이면 된다.
-- 행이 몇 십 건뿐이면 플래너가 Seq Scan을 고를 수 있다 — 그 경우
-- set enable_seqscan = off; 를 앞에 붙여 인덱스가 쓰이는지만 확인한다.
--
-- explain analyze
-- select id from inquiries
-- where game_id = '<게임 uuid>'
--   and (title ilike '%환불%' or inquiry_no ilike '%환불%'
--        or game_account ilike '%환불%' or content ilike '%환불%')
-- order by created_at desc
-- limit 50;
