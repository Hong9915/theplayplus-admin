# 사용자 회신 자동 동기화 설계

작성일: 2026-09-07

## 목표

관리자가 "회신 확인" 버튼을 누르지 않아도 사용자가 이메일로 보낸 회신이 문의 타임라인에
자동으로 쌓이고, 목록과 문의함 보기에서 "회신이 온 문의"를 바로 알아볼 수 있게 한다.

- 회신 도착까지 허용 지연: 5분 안팎. 실시간(Gmail push)은 운영 부담이 커서 제외한다.
- 기존 "회신 확인" 버튼은 그대로 둔다. 5분을 못 기다릴 때 바로 확인하는 용도다.
- 회신이 와도 문의 상태는 바꾸지 않는다. Slack 알림도 이번엔 넣지 않는다(확장 지점만 둔다).

## 현재 구조

- 답변을 보내면 `inquiries.gmail_thread_id`에 Gmail 스레드 id가 저장된다(`lib/send-reply.ts`).
- `POST /api/inquiries/{id}/sync-replies`가 그 스레드를 `threads.get`으로 읽어 우리 발신 주소가
  아닌 메일만 `inquiry_messages`에 inbound로 넣는다(`lib/gmail.ts`의 `fetchInboundReplies`,
  `lib/messages.ts`의 `createInboundMessage`). `gmail_message_id` 부분 유니크 인덱스가 있어
  같은 메일은 두 번 들어가지 않는다.
- 발신 계정은 문의 스코프로 갈린다(`Mailbox` = `game` | `service`). 서비스용 환경변수가 둘 다
  비면 게임 계정으로 대체된다.
- Supabase `pg_cron` + `pg_net`이 매분 `/api/auto-reply/run`을 `x-webhook-secret` 헤더와 함께
  호출한다(마이그레이션 0014). Vault의 `inquiry_webhook_secret`을 헤더에 쓴다.
- 문의함 보기 건수는 `inquiry_facet_counts(p_game_id)` RPC 한 번으로 온다(0008, 0012).

## 설계

### 1. Gmail 조회 (`lib/reply-sync.ts`, `lib/gmail.ts`)

문의마다 스레드를 여는 대신, 메일함 하나당 "마지막 확인 시각 이후 받은 메일"을 한 번에 가져온다.

- `lib/gmail.ts`에 `listInboundSince(mailbox, since: Date): Promise<InboundEmailWithThread[]>` 추가.
  - `users.messages.list({ q: "after:<epoch초> -from:<발신주소>", maxResults: 100 })`로 id 목록을 얻고,
    `nextPageToken`이 있으면 이어서 받는다(상한 500건, 넘으면 다음 실행에서 이어간다).
  - 각 id를 `users.messages.get({ format: "full" })`로 읽어 `threadId`, From, Message-ID, 본문,
    internalDate를 뽑는다. 본문 정리는 기존 `extractPlainText` + `stripQuotedReply`를 그대로 쓴다.
  - From이 발신 주소와 같으면(검색어를 뚫고 온 경우) 건너뛴다.
  - 반환 타입은 기존 `InboundEmail`에 `threadId: string`을 더한 것.
- `lib/reply-sync.ts`의 `syncMailbox(supabase, mailbox, now)`:
  1. `gmail_sync_state`에서 그 메일함의 `synced_through`를 읽는다. 없으면 `now - 24시간`.
  2. `since = synced_through - 10분` 여유를 두고 `listInboundSince`를 부른다. 겹치는 구간의
     메일은 `gmail_message_id`로 걸러지므로 중복이 없다.
  3. 받은 메일의 `threadId` 집합으로 `inquiries`를 `gmail_thread_id in (...)`로 한 번에 조회해
     `threadId → inquiry` 맵을 만든다. 맵에 없는 메일(새 문의 안내, 광고 등)은 무시한다.
  4. 각 메일을 `createInboundMessage`로 넣는다. 본문이 비면 건너뛴다(지금 버튼과 같음).
     새로 들어간 문의는 `inquiries.unread_reply_at = 메일 sent_at`(이미 값이 있으면 더 이른 값 유지)로 갱신한다.
  5. 모두 처리하면 `synced_through = now`로 저장한다. Gmail 조회가 실패하면 저장하지 않고
     오류를 던져 다음 실행이 같은 구간을 다시 본다. 메일 한 건의 DB 저장 실패는 로그만 남기고 계속한다.
  6. 결과 `{ mailbox, fetched, matched, added }`를 돌려준다.
- `syncAllMailboxes(supabase)`: `game`, `service` 두 메일함을 돌되 `mailboxSender()`가 같은 주소면
  (서비스 계정 미설정으로 게임 계정 대체) 한 번만 돈다. 한 메일함 실패가 다른 메일함을 막지 않는다.

### 2. DB (마이그레이션 `0017_reply_sync.sql`)

0016은 자동 답변 지연 범위 변경이 먼저 가져갔다. `feat/sheet-assistant` 브랜치의 0016/0017과는 나중에 머지하는 쪽이 번호를 옮긴다.

```sql
alter table inquiries add column if not exists unread_reply_at timestamptz;
create index if not exists inquiries_unread_reply_idx on inquiries (game_id) where unread_reply_at is not null;

create table if not exists gmail_sync_state (
  mailbox        text primary key,           -- 'game' | 'service'
  synced_through timestamptz not null,
  updated_at     timestamptz not null default now()
);
-- RLS: service_role만. 관리자 UI는 이 표를 읽지 않는다.

-- inquiry_facet_counts에 'unread' 항목 추가 (0012 본문에 union all 한 줄).
--   select 'unread', '1', count(*) from scoped where unread_reply_at is not null
-- scoped CTE의 select 목록에 unread_reply_at 추가.

-- pg_cron: 5분마다 /api/replies/sync 호출. 0014와 같은 형태, jobname 'reply-sync-run'.
```

### 3. API

- `POST /api/replies/sync` — `isWebhookAuthorized`로 인증. `syncAllMailboxes`를 부르고
  `{ success: true, results: [...] }`를 돌려준다. 메일함이 모두 실패하면 502.
- `POST /api/inquiries/{id}/mark-read` — 관리자 세션 필요. `unread_reply_at = null`.
  이미 null이면 그냥 성공.
- `lib/send-reply.ts`: 수동 답변(`mode: "manual"`) 발송 성공 시 patch에 `unread_reply_at: null` 추가.
  자동 답변은 건드리지 않는다.
- 기존 `sync-replies`(버튼)는 `unread_reply_at`을 세우지 않는다. 관리자가 보고 있는 화면이다.

### 4. 화면

- `InquiryRow`에 `unreadReplyAt: string | null` 추가(`lib/inquiries.ts`의 select 목록과 매핑).
- `InquiryListQuery`에 `unread: boolean` 추가. URL 파라미터 `unread=1`. `queryInquiries`에서
  `unread_reply_at is not null` 조건. `hasActiveFilter`에 포함.
- `InboxNav`: 보기 목록에 `{ key: "unread", label: "회신 도착", patch: { status: null, stale: false, unread: true } }`
  추가. 다른 보기의 patch에는 `unread: false`. 건수는 `counts.unread`. 0보다 크면 stale처럼 강조.
- `InboxList` 행: `unreadReplyAt`이 있으면 상태 배지 옆에 "회신 옴" 배지(accent 색).
- `InboxConversation`: 선택한 문의의 `unreadReplyAt`이 있으면 `MarkReadOnOpen` 클라이언트 컴포넌트를
  렌더. 마운트 시 `POST /api/inquiries/{id}/mark-read`를 부르고 성공하면 `router.refresh()`로
  배지를 지운다. 실패는 조용히 무시(다음 열람 때 다시 시도).
- `InquiryFacetCounts`에 `unread: number` 추가.

### 5. 실패 처리

- Gmail 토큰에 `gmail.readonly`가 없으면 조회가 실패한다. 로그에 메일함 이름과 함께 남기고
  `synced_through`는 갱신하지 않는다. 라우트 응답의 `results`에 `error: "fetch_failed"`로 표시.
- `gmail_sync_state`가 비어 있을 때 첫 실행은 24시간 전부터 본다. 그 전 회신은 버튼으로 가져온다.
- 같은 5분 안에 호출이 겹쳐도 `gmail_message_id` 유니크 인덱스가 중복을 막는다.
  `synced_through`는 나중에 끝난 쪽이 덮어써도 문제없다(둘 다 `now`).

### 6. 테스트 (Vitest)

- `tests/lib/reply-sync.test.ts`: Gmail 함수와 Supabase 클라이언트를 목킹해
  - 스레드가 문의와 맞는 메일만 저장되고 `unread_reply_at`이 세워진다
  - 이미 있는 `gmail_message_id`는 건너뛴다(`createInboundMessage`가 false)
  - 본문이 비면 건너뛴다
  - Gmail 실패 시 `synced_through`를 갱신하지 않는다
  - 게임·서비스 발신 주소가 같으면 한 번만 돈다
- `tests/lib/gmail.test.ts`: `listInboundSince`의 검색어 조립과 페이지 이어받기(googleapis 목킹).
- `tests/lib/inquiry-filters.test.ts`(없으면 신설): `unread=1` 파싱과 링크 생성.
- 컴포넌트: `InboxNav`에 "회신 도착" 보기와 건수, `InboxList`에 "회신 옴" 배지, `MarkReadOnOpen`이
  마운트 시 fetch를 부른다.
- 라우트: `/api/replies/sync` 비밀값 불일치 401, `/mark-read` 세션 없음 401.

### 7. 운영 절차 (CLAUDE.md에 추가)

1. 두 발신 계정의 refresh token에 `gmail.readonly`가 있는지 확인(없으면 `scripts/get-gmail-refresh-token.js`로 재발급).
2. `0016_reply_sync.sql` 실행. Vault의 `inquiry_webhook_secret`은 자동 답변 설정 때 넣은 것을 그대로 쓴다.
3. 테스트 문의에 답변을 보내고 그 메일에 회신한 뒤 5분 안에 목록에 "회신 옴"이 뜨는지 확인.
   실행 기록은 `cron.job_run_details`에서 `reply-sync-run`으로 본다.

## 제외

- Slack 회신 알림: `syncMailbox`가 `added` 목록을 돌려주므로 라우트에서 붙일 수 있다.
- 상태 자동 변경, 읽지 않은 회신 수 배지(게임 레일), Gmail push.
