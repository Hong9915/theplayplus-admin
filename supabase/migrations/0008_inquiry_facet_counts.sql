-- 문의함 보기 열의 건수(상태별·유형별·우선순위별·3일 이상 미처리·전체)를
-- 한 번의 RPC로 가져온다. 행을 다 읽어 앱에서 세면 PostgREST 기본 1,000행
-- 제한에 걸리므로 DB에서 센다. 72시간 기준은 lib/inquiries.ts STALE_AFTER_MS와 같다.

create or replace function inquiry_facet_counts(p_game_id uuid)
returns table (facet text, key text, count bigint)
language sql
stable
as $$
  select 'status'::text, status::text, count(*) from inquiries where game_id = p_game_id group by status
  union all
  select 'type', type_key, count(*) from inquiries where game_id = p_game_id group by type_key
  union all
  select 'priority', coalesce(priority, 'normal'), count(*) from inquiries where game_id = p_game_id group by 2
  union all
  select 'stale', '1', count(*) from inquiries
    where game_id = p_game_id and status <> 'resolved' and created_at < now() - interval '72 hours'
  union all
  select 'total', 'all', count(*) from inquiries where game_id = p_game_id
$$;

-- 관리자 앱은 service-role 클라이언트로 호출한다. 접수 폼(anon)에는 열지 않는다.
revoke execute on function inquiry_facet_counts(uuid) from public, anon, authenticated;
grant execute on function inquiry_facet_counts(uuid) to service_role;
