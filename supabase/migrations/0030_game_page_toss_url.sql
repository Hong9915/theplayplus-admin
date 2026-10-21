-- 웹사이트 게임 카드·상세의 앱인토스(토스 앱 안 미니앱) 링크. 토스 공유 링크(https)를 받는다.
-- intoss:// 딥링크는 토스 앱 안에서만 열려 웹사이트 버튼으로 쓸 수 없다.
alter table game_pages add column if not exists toss_url text;
