-- 웹사이트 게임 상세 히어로의 "출시일"·"사전예약 기간". 글자로 받는다
-- ("2026.08.20", "2026년 4분기 출시 예정", "2026.09.30 ~ 2026.10.30"). 비어 있으면 웹에서 숨긴다.
alter table game_pages add column if not exists release_date text;
alter table game_pages add column if not exists prereg_period text;
