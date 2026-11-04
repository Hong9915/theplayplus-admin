-- 고객센터 게임 선택 타일의 부제. 관리자 게임 설정(게임 추가 폼·게임 설정 서랍의 "부제")에서 적는다.
--   games.subtitle : 예) "방치형 판타지 수집 RPG". 비어 있으면(null) 접수 폼은 이름의 콜론(:) 뒤를 부제로 쓴다.
-- 2026-11-04 결정. Safe to re-run.
-- (theplayplus-web 저장소의 0012_game_subtitle.sql과 같은 내용. 같은 Supabase에 한 번만 실행한다.)
-- 관리자 게임 추가·부제 저장이 이 열에 쓰므로 관리자 배포 전에 실행해야 한다.

alter table games add column if not exists subtitle text;
