-- 웹사이트 게임 페이지의 공지사항은 네이버 라운지 '공지사항' 게시판을 웹이 직접 읽어 보여준다.
-- 관리자에서 따로 쓰던 공지(game_notices)와, 문의함에서 이미 연결하는 라운지와 겹치던
-- 라운지 주소 칸(game_pages.naver_lounge_url)은 쓰지 않는다. 라운지는 games.naver_lounge_id 하나로 본다.

drop table if exists game_notices;

alter table game_pages drop column if exists naver_lounge_url;
