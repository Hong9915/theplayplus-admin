# 네이버 게임 라운지 새 글·댓글 알림 설계

작성일: 2026-09-21

## 목표

게임의 네이버 게임 라운지 게시판에 유저가 글이나 댓글을 쓰면 관리자 페이지와 Slack으로 알리고,
알림을 누르면 라운지의 그 글로 바로 이동하게 한다. 네이버는 라운지 운영자에게 새 글 알림을 주지 않는다.

- 알림 대상: 일반 유저(`userRoleCode = common_user`)가 쓴 글·댓글·답글. GM·운영자가 쓴 것은 알리지 않는다.
- 허용 지연: 5분 안팎(회신 동기화와 같은 `pg_cron` 주기).
- 라운지에 글을 쓰거나 답하는 기능은 없다. 읽기와 이동뿐이다.

## 조사 결과 (2026-09-21 실측)

라운지 웹이 쓰는 내부 API 두 개가 로그인·쿠키 없이 서버에서 응답한다. `Referer: https://game.naver.com/`와
일반 브라우저 `User-Agent`를 붙여 호출했다. 글 목록의 `limit`은 30까지다(50은 400 `30002`). 공식 API가 아니므로 예고 없이 바뀔 수 있다.

- 글 목록: `GET https://comm-api.game.naver.com/nng_main/v1/community/lounge/{loungeId}/feed?boardId=0&buffFilteringYN=N&limit=30&offset=0&order=NEW`
  - `content.feeds[]`의 항목마다 `feed.feedId`, `feed.title`, `feed.contents`(SmartEditor JSON 문자열),
    `feed.createdDate`(`yyyyMMddHHmmss`, KST), `board.boardName`, `user.nickname`, `user.userRoleCode`,
    `comment.totalCount`(댓글+답글 수), `feedLink.pc`(글 주소)가 온다.
- 댓글: `GET https://apis.naver.com/nng_main/nng_comment_api/v1/type/FEED/id/{feedId}/comments?originalLoungeId={loungeId}&limit=30&offset=0&orderType=NEW&pagingType=PAGE`
  - `content.comments.data[]`의 항목마다 `comment.commentId`, `comment.content`, `comment.createdDate`,
    `comment.secret`, `comment.deleted`, `user.userNickname`, `user.userRoleCode`(GM은 `game_manager`),
    그리고 같은 모양의 `replyComments[]`(답글)가 온다.
- 라운지 주소는 `https://game.naver.com/lounge/{loungeId}/...` 꼴이고 `loungeId`는 영문·숫자·밑줄이다.

## 설계

### 1. 네이버 읽기 (`lib/naver-lounge.ts`)

외부 API를 아는 유일한 파일이다. 응답은 zod로 필요한 필드만 검증하고, 모양이 다르면 던진다.

- `parseLoungeId(input): string | null` — 라운지 URL 또는 ID 문자열에서 ID를 뽑는다.
- `fetchLoungePosts(loungeId): Promise<LoungePost[]>` — 최신 30건. `LoungePost` =
  `{ feedId, title, bodyText, boardName, nickname, isUser, postedAt, url, commentCount }`.
  `bodyText`는 `contents` JSON에서 `textNode`의 `value`를 단락마다 줄바꿈으로 이은 것(파싱 실패는 빈 문자열).
  제목의 HTML 엔티티(`&#x1f430;` 등)는 풀어 준다.
- `fetchLoungeComments(loungeId, feedId): Promise<LoungeComment[]>` — 첫 페이지(30건)의 댓글과 그 답글을
  평평하게 편 목록. `LoungeComment` = `{ commentId, feedId, bodyText, nickname, isUser, postedAt }`.
  `deleted`는 빼고, `secret`이면 `bodyText`를 `"(비밀 댓글)"`로 둔다. 내용이 비고 첨부만 있으면 `"(스티커·이미지)"`.
- `isUser`는 `userRoleCode === "common_user"`. `createdDate`는 KST로 읽어 ISO 문자열로 바꾼다.
- 요청마다 10초 타임아웃.

### 2. DB (마이그레이션 `0024_naver_lounge.sql`)

```sql
alter table games add column if not exists naver_lounge_id text;
alter table games add column if not exists lounge_synced_at timestamptz;

create table if not exists lounge_items (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  kind text not null check (kind in ('post', 'comment')),
  naver_id bigint not null,          -- 글이면 feedId, 댓글이면 commentId
  feed_id bigint not null,           -- 속한 글(글이면 naver_id와 같다)
  title text not null,               -- 글 제목(댓글이면 속한 글의 제목)
  body text not null default '',     -- 본문 발췌(1,000자까지)
  board_name text,
  nickname text,
  is_user boolean not null,
  url text not null,
  comment_count integer,             -- 글에만: 마지막으로 본 댓글 수
  posted_at timestamptz not null,
  read_at timestamptz,               -- null이면 안 읽음
  created_at timestamptz not null default now(),
  unique (game_id, kind, naver_id)
);
create index if not exists lounge_items_unread_idx on lounge_items (game_id) where read_at is null;
alter table lounge_items enable row level security;  -- 정책 없음: service_role만
```

- GM·운영자가 쓴 항목도 저장한다(공지 글에 달리는 유저 댓글을 잡으려면 그 글의 `comment_count`를
  알아야 한다). 대신 `read_at`을 저장 시각으로 채워 안 읽음 건수와 Slack에서 빠진다.
- `games`의 새 열은 anon에 열지 않는다(0018의 열 단위 grant는 그대로 둔다).
- `pg_cron` 잡 `lounge-sync-run`이 5분마다 `https://admin.theplayplus.com/api/lounge/sync`를
  Vault의 `inquiry_webhook_secret`과 함께 호출한다(0017과 같은 블록, 재실행 안전).

### 3. 동기화 (`lib/lounge-sync.ts`, `app/api/lounge/sync/route.ts`)

`syncAllLounges(supabase, options): Promise<LoungeSyncResult[]>` — `naver_lounge_id`가 있는 게임을 차례로 돈다.
결과는 게임마다 `{ gameId, gameName, fetched, added: LoungeItemRow[], error?: "fetch_failed" }`.
`added`는 이번에 새로 들어간 **유저 항목**만 담는다(Slack이 이걸 쓴다).

`syncLounge(supabase, game)`:

1. `fetchLoungePosts`. 실패하면 `fetch_failed`로 끝내고 `lounge_synced_at`을 건드리지 않는다.
2. 그 게임의 `kind='post'` 행을 `feed_id in (...)`로 읽어 `feedId → comment_count` 맵을 만든다.
3. 처음 보는 글은 insert. `comment_count`는 0으로 넣어 4번에서 댓글을 한 번 읽게 한다.
4. 네이버의 `commentCount`가 저장값과 다른 글만 `fetchLoungeComments`를 불러 처음 보는 댓글을 insert하고,
   성공하면 글의 `comment_count`를 갱신한다. 댓글 읽기 실패는 경고만 남기고 `comment_count`를 그대로 둬
   다음 실행이 다시 본다. 한 번 실행에 댓글을 읽는 글은 20개까지(서버리스 시간 제한).
5. 안 읽음 판정: 유저 항목이고 `posted_at`이 **이전** `lounge_synced_at`보다 뒤일 때만 `read_at = null`로 넣고
   `added`에 담는다. 그 밖(GM 항목, 기준 시각 이전 항목)은 `read_at = now`. 기준에는 **2분 여유**를 둬
   (`이전 시각 − 2분`) 네이버의 초 단위 시각·반영 지연·시계 차이로 갓 올라온 글이 기준 바로 앞에 놓여도
   알림이 되게 한다. 이미 넣은 항목은 유니크 인덱스가 걸러 중복 알림이 생기지 않으므로 여유는 공짜다.
   첫 실행은 `lounge_synced_at`이 null이라 기준을 now로 잡고 **여유도 두지 않아** 기존 글·댓글이 전부 읽음이 된다.
6. `games.lounge_synced_at = now`(실행을 시작한 시각). 단, 이번 실행이 **못 본 것을 남겼으면 옮기지 않는다** —
   댓글 읽기 실패, 4번의 20개 상한에 걸린 글, 시간 예산(아래)에 걸려 멈춘 경우다. 기준을 그대로 두면 다음
   실행이 같은 기준으로 다시 봐 놓친 항목이 안 읽음으로 들어간다(기준을 옮겨 버리면 그 사이 댓글이
   기준보다 앞서게 돼 조용히 읽음으로 저장된다). 첫 실행만은 미완이어도 옮긴다 — 기준이 없으면 다음
   실행도 기존 글을 전부 읽음으로 넣고 끝나 소용이 없다.
7. 시간 예산: 한 번 호출에 40초(라우트의 `maxDuration = 60`보다 짧게). 넘으면 새 댓글 조회·새 게임을
   시작하지 않고 그 게임을 미완으로 두고 끝낸다. 남은 일은 5분 뒤 다음 실행이 한다.

중복은 유니크 인덱스가 거른다(insert는 `upsert(..., { onConflict, ignoreDuplicates: true })`).
한계: 최신 30건보다 오래된 글의 새 댓글, 한 글에서 5분 사이 30건을 넘긴 댓글은 놓친다.

라우트는 `/api/replies/sync`와 같은 모양이다: `isWebhookAuthorized` → `syncAllLounges` → 모든 게임이
실패하면 502 `sync_failed`, 아니면 200. Slack은 게임 하나가 끝날 때마다 `onGameSynced` 콜백으로 보낸다(5번) —
뒤 게임에서 시간이 다 돼도 앞 게임 알림은 이미 나가 있다(다음 실행에서 그 항목은 중복이라 `added`에 다시 오지 않는다).

### 4. 관리자 화면

- **연결**: `InboxNav` 아래쪽(답변 템플릿 옆)에 "네이버 라운지 연결" 버튼 → 대화상자(`components/inbox/LoungeConnectDialog.tsx`,
  URL 입력). `PATCH /api/games/{gameId}/lounge`가 `requireAdminSession` → `parseLoungeId` → `fetchLoungePosts`로
  실제로 읽히는지 확인(실패 시 400 `lounge_unreachable`) → `naver_lounge_id` 저장, `lounge_synced_at`은 null로 되돌린다.
  빈 값이면 연결 해제. 연결을 바꾸면 그 게임의 `lounge_items`를 지운다(다른 라운지의 글이 섞이지 않게).
- **게임 추가 시 연결**: `GameForm`에 선택 입력 "네이버 라운지 주소"를 더하고 `POST /api/games`가 `loungeUrl`을 받는다
  (`gameFormSchema`에 optional 문자열). 게임을 저장한 뒤 `parseLoungeId` → `fetchLoungePosts`로 확인해 되면
  `naver_lounge_id`를 저장한다. 주소가 틀렸거나 못 읽으면 게임은 그대로 만들고 `lounge_unreachable` 경고만 낸다
  (로고·운영 문서와 같은 "부가 작업 실패는 경고" 규칙). 확인·저장 로직은 PATCH 라우트와 `lib/lounge-connect.ts`의
  `connectLounge(supabase, gameId, input)`로 공유한다.
- **보기 열**: 라운지가 연결된 게임이면 `InboxNav`에 "라운지 새 글" 링크와 안 읽은 건수(0보다 크면 강조색).
  건수는 `lib/lounge-items.ts`의 `countUnreadLoungeItems(supabase, gameId)`로 `loadInboxPage`의 `Promise.all`에서
  읽고 실패하면 건수 없이 그린다. 문의 필터가 아니므로 `inquiry_facet_counts` RPC는 건드리지 않는다.
- **목록**: `app/(admin)/games/[gameId]/lounge/page.tsx`. 최신순 100건, 항목마다 글/댓글 표시·게시판·제목·본문 발췌·
  닉네임·시각. 안 읽은 항목은 굵게, GM 항목은 흐리게. 항목은 `url`을 새 탭으로 여는 링크이고 누르면
  `POST /api/lounge/items/{id}/read`로 읽음 처리한다(`components/lounge/LoungeItemList.tsx`, 클라이언트).
  위쪽에 "모두 읽음"(`POST /api/games/{gameId}/lounge/read-all`)과 "라운지 열기 ↗".
- **게임 레일**: `GameRail`에 `loungeCounts` prop을 더해 타일에 초록 배지(접수 배지와 반대쪽 모서리,
  `sr-only` "라운지 새 글 N건"). `app/(admin)/layout.tsx`의 `Promise.all`에 `countUnreadLoungeItemsByGame`을 더한다.

`GameRow`/`mapGameRow`에 `naverLoungeId`를 더한다.

### 5. Slack (`lib/slack.ts`)

`buildLoungeSlackMessage({ gameName, items, listUrl })` 추가(`listUrl`은 관리자 목록 주소, "외 N건"은 `items` 수로 센다). 항목마다 section 하나:
`💬 *[게임명] 라운지 새 글*`(댓글이면 "라운지 새 댓글") / `게시판 · 닉네임` / `<url|제목>` / 본문 인용(기존 `quoteBody`, 600자).
색은 `#03C75A`. 유저가 쓴 글자는 모두 `escapeMrkdwn`. 한 게임에서 한 번에 5건을 넘으면 앞 5건만 싣고
context에 "외 N건"을 적는다. 게임마다 메시지 하나.

라우트는 `SLACK_WEBHOOK_URL`이 없으면 조용히 건너뛰고, 전송 실패는 `console.error`만 남긴다(저장은 끝났고
관리자 화면에는 보인다). 응답에 `notified` 건수를 싣는다.

## 오류 처리

| 상황 | 동작 |
| --- | --- |
| 네이버 글 목록 실패·응답 모양 변경 | 그 게임 `fetch_failed`, 다음 실행이 다시 시도. 다른 게임은 계속 |
| 댓글 읽기 실패 | 경고 로그, `comment_count`와 `lounge_synced_at`을 그대로 둔다 → 다음 실행이 같은 기준으로 다시 읽어 그 댓글을 안 읽음으로 넣는다 |
| 상한(20개)·시간 예산으로 남은 글 | 미완으로 보고 `lounge_synced_at`을 옮기지 않는다 → 다음 실행이 이어서 본다(첫 실행은 예외, 언제나 옮긴다) |
| Slack 실패 | 로그만. 항목은 저장돼 화면에 보인다 |
| 연결 시 라운지를 못 읽음 | 400 `lounge_unreachable`, 저장하지 않음 |
| 건수 조회 실패 | 건수·배지 없이 그린다 |

## 테스트

- `tests/lib/naver-lounge.test.ts`: `parseLoungeId`(URL·ID·잘못된 값), 글·댓글 응답 파싱(실측 응답을 줄인 fixture),
  SmartEditor 본문 추출, 엔티티 풀기, KST 시각, 비밀·삭제·스티커 댓글, 모양이 다르면 throw. `fetch`는 `vi.stubGlobal`.
- `tests/lib/lounge-sync.test.ts`: 가짜 Supabase(`reply-sync` 테스트와 같은 손으로 만든 객체) + `@/lib/naver-lounge` 모킹.
  첫 실행은 전부 읽음·`added` 비움 / 새 유저 글 / GM 글은 읽음 / 댓글 수가 바뀐 글만 댓글 조회 / 댓글 실패 시
  `comment_count` 유지 / 글 목록 실패 시 `lounge_synced_at` 유지.
- `tests/api/lounge-sync.test.ts`: 401, 200, 전부 실패 502, Slack 미설정·실패.
- `tests/api/games-lounge.test.ts`: 연결·해제·못 읽는 라운지·권한.
- `tests/lib/slack.test.ts`에 라운지 메시지(escape, 5건 초과 요약), `InboxNav`·`GameRail` 컴포넌트 테스트에 링크·배지.

## 문서

`CLAUDE.md`에 기능 12번과 "네이버 라운지 알림 설정 절차"(0024 실행 → 게임에서 라운지 연결 → 라운지에 테스트 글)를 더한다.
