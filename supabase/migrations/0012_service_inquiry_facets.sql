-- 문의함 보기 건수 RPC가 p_game_id = null을 "게임 없는 서비스 문의(제휴·기타)"로 센다.
-- 0008은 game_id = p_game_id 비교라 null이면 항상 거짓이었다. "is not distinct from"
-- 대신 or로 푼 이유: 그 연산자는 btree 인덱스를 못 타지만 아래 형태는 game_id 인덱스를
-- 쓸 수 있다. 서명이 같아 create or replace로 덮어쓰며, 0008의 권한 설정은 그대로다.
-- 재실행 안전.

create or replace function inquiry_facet_counts(p_game_id uuid)
returns table (facet text, key text, count bigint)
language sql
stable
as $$
  with scoped as (
    select status, type_key, priority, created_at
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
  select 'total', 'all', count(*) from scoped
$$;

revoke execute on function inquiry_facet_counts(uuid) from public, anon, authenticated;
grant execute on function inquiry_facet_counts(uuid) to service_role;
