-- 게임 문의에 서버(구역)·캐릭터 ID·캐릭터명을 받는다. 개발사에 버그·복구 건을 넘길 때 쓰는 양식의 칸이다.
--   inquiry_types.collects_character : 이 유형이 세 칸을 받는지 (세 칸 모두 필수, 서버는 직접 입력)
--   inquiries.server_name / character_id / character_name : 사용자가 적은 값
-- 숲의 소환단(e3f0996f-…)의 건의 사항·게임 내용·버그 제보(기타)·복구 문의에 켜고, 같은 유형에 발생 일시(collects_occurred_at)도 켠다.
-- 2026-10-30 결정. Safe to re-run.
-- (theplayplus-web 저장소의 0011_inquiry_character.sql과 같은 내용. 같은 Supabase에 한 번만 실행한다.)
-- 접수 폼과 관리자 문의함이 새 열을 읽으므로 두 앱을 배포하기 전에 실행해야 한다.

alter table inquiry_types add column if not exists collects_character boolean not null default false;
alter table inquiries add column if not exists server_name text;
alter table inquiries add column if not exists character_id text;
alter table inquiries add column if not exists character_name text;

update inquiry_types t
   set collects_character = true,
       collects_occurred_at = true
  from inquiry_groups g
 where t.group_id = g.id
   and g.game_id = 'e3f0996f-c9b0-4d91-91cc-e3a02319df9b'
   and g.key = 'game_usage'
   and t.key in ('suggestion', 'game_content', 'bug_report', 'restore_request');
