-- 웹사이트 게임 상세의 운영정책 링크. 보통 네이버 라운지의 운영정책 글 주소를 넣는다.
alter table game_pages add column if not exists policy_url text;
