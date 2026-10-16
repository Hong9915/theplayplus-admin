-- 원스토어 내용 자동 반영. 켜면 웹사이트(theplayplus-web)가 원스토어 상품 페이지를 1시간 캐시로
-- 직접 읽어 제목·장르·이용등급·게임 소개·스크린샷을 보여주고, 못 읽으면 저장된 값을 쓴다.
alter table game_pages add column if not exists onestore_sync boolean not null default false;
