-- 참조용 사본. 원본은 theplayplus-web 저장소의 supabase/migrations/0010_store_all_game_types.sql이며
-- 같은 Supabase 프로젝트에 한 번만 실행한다(0009/0022 다음).

-- 스토어 종류를 결제·환불뿐 아니라 모든 게임 문의 유형에서 필수로 받는다.
-- inquiry_types는 게임 유형만 담는 표라(서비스 문의는 service_types) 전부 켜면 된다. Safe to re-run.

update inquiry_types set collects_store = true where collects_store = false;
