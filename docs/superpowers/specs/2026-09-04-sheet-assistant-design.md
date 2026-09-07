# 운영 시트 어시스턴트 설계

작성일: 2026-09-04

시트 연결(games.sheet_id)·시트 설정 모달·PATCH /api/games/[gameId] 부분은 2026-09-07-assistant-sources-design.md로 대체됐다.

## 배경

게임 운영 담당자는 충전 이벤트 보상(ID별 충전액·지급 코드), VIP 유저 명단(이메일/ID/서버/닉네임/누적 보상), 호평 리워드 코드 목록(사용 여부 메모) 같은 운영 원장을 텍스트 파일과 구글 시트에 쌓아 둔다(예: `여신 키우기 보상관련` 폴더의 txt 20여 개, 총 50KB 안팎). 문의를 처리하다 "이 계정 VIP 몇이지", "9월 2일 보상 코드 줬나"를 확인하려면 파일을 열어 눈으로 찾아야 한다.

이 원장을 게임별 구글 스프레드시트 하나로 정리하고, 관리자 페이지에서 자연어로 묻고 답을 받는 화면을 만든다. "test@gmail.com 이 계정 VIP4로 올라갔어"처럼 말하면 시트의 해당 행을 고치는 것까지 지원하되, 실제 쓰기는 관리자가 확인 버튼을 누른 뒤에만 한다.

## 결정 사항 (2026-09-04)

- 모델: **OpenAI**(`openai` 패키지, `OPENAI_API_KEY`, `OPENAI_MODEL` 기본 `gpt-5-mini`). 답변 제안 기능이 쓰는 Gemini와는 별개다.
- 시트 접근: **Google 서비스 계정**. 관리자가 시트를 그 계정 이메일에 편집자로 공유한다.
- 수정: **확인 후 적용**. 모델은 제안만 만들고, 관리자가 [적용]을 눌러야 시트에 쓴다.
- 시트 연결: `games.sheet_id` 열을 추가하고 어시스턴트 화면의 "시트 설정"에서 URL을 입력한다.
- 대화 저장: DB에 저장하고 ChatGPT식 사이드바로 게임별 대화 목록을 보여준다.
- 검색 방식: 임베딩 없이 **시트 전체를 프롬프트에 싣는다**. 현재 규모(탭당 수백 행)에서는 이쪽이 더 정확하고 단순하며, 집계 질문에도 강하다. 비용은 GPT-5 mini 기준 질문 1건당 $0.01 미만이다. 시트가 수천 행으로 커지면 그때 `lib/sheets.ts`만 바꿔 검색 방식을 교체한다.

## 목표

- 문의함 보기 열에서 한 번 눌러 새 탭에 어시스턴트가 열린다.
- 시트 내용만 근거로 한국어로 답하고 근거 탭·행을 밝힌다. 없는 내용은 지어내지 않는다.
- 수정 요청은 "어느 탭 어느 행의 어느 열을 무엇에서 무엇으로" 카드로 보여주고, 적용하면 시트에 반영된다. 누가 언제 적용했는지 대화에 남는다.
- 설정이 빠졌거나 시트 공유가 안 됐을 때 무엇을 고쳐야 하는지 화면이 알려준다.

## 범위 밖

- 서비스 문의(게임 없음) 스코프. 링크를 보이지 않는다.
- 게임 편집 화면 신설. 시트 URL만 어시스턴트 화면에서 받는다.
- 시트 구조 자동 변환. 줄글로 쌓인 탭은 읽기만 하고, 수정은 첫 줄이 열 이름인 탭에서만 한다.
- 행 삭제, 열 추가, 여러 행 일괄 수정. 제안은 `update`(한 행의 몇 열)와 `append`(한 행 추가) 두 종류뿐이다.
- 이미지·PDF 첨부, 대화 공유, 대화 제목 편집. (텍스트·표 파일 첨부는 2026-09-07에 추가했다. 아래 "첨부 파일" 참고)

## 화면

### 진입

`components/inbox/InboxNav.tsx`의 검색창과 "접수" 보기 사이에 `운영 어시스턴트 ↗` 링크를 둔다. `href="/games/{gameId}/assistant"`, `target="_blank"`, `rel="noopener"`. 게임 스코프에서만 그린다.

### 레이아웃

새 라우트 그룹 `app/(assistant)/games/[gameId]/assistant/page.tsx`. 관리자 레일(`app/(admin)/layout.tsx`)을 쓰지 않고 전체 화면을 쓴다. 로그인은 `(admin)`과 같은 `lib/auth-routing.ts` 규칙을 따른다.

```
┌──────────────┬───────────────────────────────────────────┐
│ 게임명        │                                           │
│ [+ 새 대화]   │  메시지 스트림                              │
│              │   · 사용자 말풍선(오른쪽)                    │
│ 대화 목록     │   · 어시스턴트 본문(왼쪽, 스트리밍)           │
│  · 제목 (호버 │   · 수정 제안 카드                          │
│    시 삭제)   │   · 적용 결과                               │
│              │                                           │
│              ├───────────────────────────────────────────┤
│ ⚙ 시트 설정   │  [입력창 …………………………………]  [보내기]   │
└──────────────┴───────────────────────────────────────────┘
```

- 사이드바 260px. 대화 목록은 `updated_at` 내림차순. 선택된 대화는 `?c={conversationId}`로 URL에 남는다.
- 입력창은 여러 줄, Cmd/Ctrl+Enter 또는 버튼으로 전송. 전송 중에는 비활성.
- 대화가 없거나 선택하지 않았으면 빈 대화 영역에 안내 문구와 입력창만 보인다. 첫 전송 시 대화를 만들고 URL을 바꾼다.
- 시트 ID가 없으면 대화 영역 대신 "시트를 연결하세요" 안내와 설정 버튼을 보인다.

### 시트 설정 모달

- 시트 URL 입력 하나. 저장 시 `PATCH /api/games/{gameId}`에 `{ sheetUrl }`을 보낸다.
- 응답의 `serviceAccountEmail`을 모달에 보여주며 "이 주소에 편집자로 공유하세요" 안내. 서비스 계정이 설정되지 않았으면 안내 대신 `GOOGLE_SERVICE_ACCOUNT_JSON`을 설정하라는 문구.
- URL에서 ID를 못 뽑으면 저장을 거부하고 인라인 오류.

### 메시지 종류

| role | 표시 |
|---|---|
| `user` | 오른쪽 말풍선 |
| `assistant` | 왼쪽 본문. 스트리밍 중에는 커서 깜빡임 |
| `proposal` | 카드. 헤더 "시트 수정 제안", 표(탭 · 행 · 열 · 이전값 → 새값 / append는 열 · 값), 하단 [적용] [취소]. `status`가 `applied`면 "적용됨 · 이메일 · 시각", `cancelled`면 "취소됨", `failed`면 사유와 함께 "실패" (재적용 버튼 없음, 다시 물어보게 한다) |
| `result` | 없음. 적용 결과는 `proposal` 행의 `status`로 표현한다 |

- 대화 제목은 첫 사용자 메시지의 앞 40자.

### 첨부 파일 (2026-09-07 추가)

- 입력창 왼쪽의 📎로 파일을 고르면 입력창 위에 칩(이름 · 크기 · ×)으로 쌓이고, 보내면 메시지와 함께 간다. 글 없이 파일만 보낼 수 있고, 그때 새 대화의 제목은 첫 파일 이름이다.
- 허용: txt, md, csv, tsv, json, xlsx. 파일당 4MB, 메시지당 합계 4MB(파일이 메시지와 한 요청으로 가므로 Vercel 서버리스 요청 본문 상한 4.5MB 아래), 메시지당 5개, 대화당 첨부 텍스트 합계 200,000자(`lib/attachment-rules.ts`). 화면은 형식·크기를 고르는 즉시 거르고, 서버가 다시 검사해 `unsupported_type` / `file_too_large` / `message_too_large` / `too_many_files` / `attachments_too_large` / `file_unreadable`로 400을 돌려준다. 합계 초과는 저장 전에 거절하므로 파일을 빼고 다시 보낼 수 있다.
- 서버(`lib/attachments.ts`)는 원본을 보관하지 않고 텍스트만 뽑는다. 텍스트 파일은 utf-8로 읽고 깨지면 EUC-KR로 다시 읽는다(BOM 제거). xlsx는 `exceljs`로 열어 시트와 같은 `serializeSheets` 형식(탭 제목 · 행 번호 · `|`)으로 바꾼다.
- 저장: `assistant_messages.attachments jsonb` = `[{ name, size, text }]`(마이그레이션 0019). 화면에는 이름·크기만 내려간다.
- 프롬프트: 그 대화의 모든 메시지 첨부를 순서대로 `# 첨부 파일` 섹션(`## 파일명` 아래 본문)으로 시트 내용 뒤에 붙이고, 첨부가 있을 때만 "첨부 파일도 근거로 쓰되 파일은 수정할 수 없다"는 규칙을 더한다. 이력의 사용자 메시지에는 `[첨부: a.txt, b.csv]`를 붙여 어느 메시지가 어떤 파일을 가져왔는지 알린다.
- 메시지 라우트는 파일이 있을 때 `multipart/form-data`(`content` + `files[]`)를, 없을 때 기존 JSON을 받는다.
- 보낸 메시지의 말풍선 아래에 파일 칩이 남는다. 파일 수정 제안은 없다.

## 데이터 모델 (마이그레이션 0018)

```sql
alter table games add column if not exists sheet_id text;

create table if not exists assistant_conversations (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references games(id) on delete cascade,
  title       text not null,
  created_by  text not null,           -- 관리자 이메일
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on assistant_conversations (game_id, updated_at desc);

create table if not exists assistant_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references assistant_conversations(id) on delete cascade,
  role             text not null check (role in ('user', 'assistant', 'proposal')),
  content          text not null default '',
  proposal         jsonb,              -- role = 'proposal'일 때만
  status           text check (status in ('pending', 'applied', 'cancelled', 'failed')),
  failure_reason   text,
  applied_by       text,
  applied_at       timestamptz,
  created_at       timestamptz not null default now()
);
create index on assistant_messages (conversation_id, created_at);

-- 관리자 앱은 service role로 접근한다. anon(접수 폼)은 이 표를 볼 이유가 없다.
alter table assistant_conversations enable row level security;
alter table assistant_messages enable row level security;

-- 접수 폼(anon)은 게임 목록만 필요하다. 시트 ID는 관리자만 본다.
revoke select on games from anon;
grant select (id, name, status, logo_path, owner_name, created_at) on games to anon;
```

RLS: 두 새 표는 정책 없이 RLS만 켠다 — service role이 우회하므로 관리자 앱은 그대로 접근하고, anon은 완전히 막힌다. `games.sheet_id`는 기존 "Public read active games" 행 단위 정책이 열까지는 가리지 않으므로, anon에는 열 단위 grant로 `id/name/status/logo_path/owner_name/created_at`만 허용하고 `sheet_id`를 뺀다(접수 폼이 실제로 쓰는 열만 확인됨).

`proposal` JSON 형태:

```ts
type Proposal =
  | { kind: "update"; sheet: string; row: number; updates: Array<{ column: string; before: string; after: string }> }
  | { kind: "append"; sheet: string; values: Record<string, string> };
```

`row`는 시트의 1-based 행 번호(헤더가 1행)다. 모델에 보여주는 표의 행 번호와 같다.

## 시트 연동 — `lib/sheets.ts`

### 인증

`GOOGLE_SERVICE_ACCOUNT_JSON`에 서비스 계정 키 파일 내용을 한 줄 JSON으로 넣는다. `googleapis`의 `google.auth.JWT`로 `https://www.googleapis.com/auth/spreadsheets` 스코프 인증. `serviceAccountEmail()`은 JSON의 `client_email`을 돌려준다(설정 안내용). 값이 없거나 JSON이 깨졌으면 `not_configured`.

### 읽기

```ts
interface SheetTab { title: string; header: string[] | null; rows: string[][] }  // rows[i]는 시트의 i+1행(헤더 포함)
readSpreadsheet(sheetId): Promise<SheetTab[]>
```

- `spreadsheets.get`으로 탭 이름을 얻고 `values.batchGet`으로 모든 탭을 한 번에 읽는다.
- 첫 행의 모든 칸이 비어 있지 않고 서로 다르면 header로 삼는다. 아니면 `header: null`(줄글 탭).
- 모든 셀 문자열 길이 합이 300,000자를 넘으면 `sheet_too_large`.
- 403이면 `sheet_forbidden`, 404면 `sheet_not_found`, 그 외는 `sheet_read_failed`.

### 프롬프트 직렬화

```ts
serializeSheets(tabs: SheetTab[]): string
```

탭마다:

```
## VIP
행 | 이메일 | ID | 서버 | 닉네임 | VIP 단계 | 갱신일
2 | a@x.com | 52009 | 3 | 토링 | VIP5 | 08.27
```

header 없는 탭은 `행 | 내용` 두 열로, 각 행의 칸을 공백으로 이어 붙인다. 모든 칸이 빈 행은 건너뛴다. 셀 안의 `|`와 줄바꿈은 공백으로 바꾼다.

### 쓰기

```ts
applyProposal(sheetId, proposal): Promise<void>   // 실패는 AssistantError throw
```

1. `readSpreadsheet`로 다시 읽는다.
2. 탭이 없거나 `header`가 null이면 `invalid_proposal`.
3. `update`: 각 `column`이 header에 있어야 하고 `row`가 2 이상 rows 길이 이하여야 한다. 현재 셀 값이 `before`와 다르면(공백 trim 후 비교) `conflict`. 통과하면 열별 A1 범위(`'탭'!C7`)로 `values.batchUpdate`, `valueInputOption: "RAW"`.
4. `append`: 모든 key가 header에 있어야 한다. header 순서로 값을 늘어놓고 없는 열은 빈 문자열로 채워 `values.append`(`insertDataOption: "INSERT_ROWS"`).
5. API 오류는 `sheet_write_failed`.

### URL 파싱

`parseSheetUrl(url): string | null` — `/spreadsheets/d/([a-zA-Z0-9-_]+)` 매치. 순수 ID(슬래시 없는 문자열)를 그대로 넣어도 받는다.

## 챗 파이프라인 — `lib/assistant.ts`

### 시스템 프롬프트

`buildAssistantPrompt({ gameName, today, sheetText }): string` (순수 함수). 규칙:

- 당신은 게임 `{gameName}` 운영 담당자를 돕는 어시스턴트다. 아래 시트 내용만 근거로 한국어로 답한다.
- 답할 때 근거가 된 탭과 행 번호를 짧게 덧붙인다("VIP 탭 7행"). 시트에 없으면 "시트에서 찾지 못했습니다"라고 말하고 추측하지 않는다.
- 사용자가 시트를 바꾸자고 하면 본문으로 설명하지 말고 `propose_update` 또는 `propose_append` 도구를 부른다. `row`와 `before`는 표에서 본 값을 그대로 넣는다. 첫 줄이 열 이름인 탭에서만 수정할 수 있다.
- 갱신일·날짜 같은 열이 있으면 오늘 날짜(`{today}`, `MM.DD` 형식)도 함께 넣는다.
- 대상 행이 여럿이거나 특정할 수 없으면 도구를 부르지 말고 어느 것인지 되묻는다.
- 오늘 날짜: `{today}`.
- 이어서 `# 시트 내용` 아래 `sheetText`.

### 도구

```ts
propose_update: { sheet: string; row: integer; updates: Array<{ column: string; before: string; after: string }> }
propose_append: { sheet: string; values: Record<string, string> }
```

### 스트리밍

```ts
type AssistantEvent =
  | { type: "text"; text: string }
  | { type: "proposal"; proposal: Proposal }
  | { type: "error"; reason: AssistantErrorReason };

streamAssistant({ system, history }): AsyncGenerator<AssistantEvent>
```

- OpenAI Chat Completions `stream: true`, `tools` 위 두 개, `tool_choice: "auto"`.
- 텍스트 델타는 `text`로 바로 흘리고, tool call 델타는 이름·인자를 모아 스트림이 끝난 뒤 JSON 파싱 → `validateProposal(tabs, proposal)`로 검사(탭·열·행 존재, header 있음) → 통과하면 `proposal`, 실패하면 `invalid_proposal` 사유의 `error`.
- `OPENAI_API_KEY`가 없으면 첫 이벤트로 `not_configured`. 401/429/5xx는 `model_failed`.

### 대화 이력

최근 20개 메시지를 `role` 그대로 넣는다. `proposal` 메시지는 `assistant` 역할의 짧은 텍스트로 바꾼다: "시트 수정 제안: VIP 탭 7행 VIP 단계 'VIP3(08.27)' → 'VIP3(08.27) VIP4(09.04)' (적용됨)". 상태별로 "(적용됨)/(취소됨)/(실패)/(대기)"를 붙여 모델이 이미 반영된 변경을 다시 제안하지 않게 한다.

## API

모두 `requireAdminSession` 필수. 실패 응답은 기존 라우트와 같이 `{ success: false, error }`.

| 메서드·경로 | 본문 | 동작 |
|---|---|---|
| `PATCH /api/games/[gameId]` | `{ sheetUrl }` | `parseSheetUrl` → `games.sheet_id` 저장. 응답 `{ success, sheetId, serviceAccountEmail }` |
| `POST /api/assistant/conversations` | `{ gameId, firstMessage }` | 대화 생성(제목 = 첫 40자) 후 `{ conversationId }`. 메시지 전송은 아래 라우트로 |
| `DELETE /api/assistant/conversations/[id]` | | 삭제(메시지 cascade) |
| `POST /api/assistant/conversations/[id]/messages` | `{ content }` | 아래 참고 |
| `POST /api/assistant/messages/[id]/apply` | | `status = 'pending'`인 proposal만. `applyProposal` 성공 → `applied` + `applied_by/at`, 실패 → `failed` + `failure_reason`. 응답 `{ success, status, failureReason? }` |
| `POST /api/assistant/messages/[id]/cancel` | | `pending` → `cancelled` |

메시지 전송 라우트 순서:

1. 대화·게임 조회. `sheet_id` 없으면 `{ error: "not_configured" }` 400.
2. `user` 메시지 저장, `updated_at` 갱신.
3. `readSpreadsheet` → 실패하면 사유를 NDJSON `error` 한 줄로 내리고 끝(사용자 메시지는 남는다).
4. `serializeSheets` → `buildAssistantPrompt` → 최근 20개 이력 → `streamAssistant`.
5. 이벤트를 NDJSON으로 중계한다. `text`는 누적, `proposal`은 즉시 `assistant_messages(role='proposal', status='pending')`로 저장한 뒤 `{ type: "proposal", messageId, proposal }`로 내린다.
6. 스트림이 끝나면 누적 텍스트가 비어 있지 않을 때 `assistant` 메시지로 저장. `error`로 끝났으면 텍스트를 저장하지 않는다(재전송 가능).

응답 헤더는 `suggest` 라우트와 같다(`application/x-ndjson`, `no-cache`).

## 클라이언트 — `components/assistant/`

- `AssistantShell` (서버에서 받은 게임·대화 목록·메시지를 props로) → `ConversationSidebar`, `ChatPane`, `SheetSettingsDialog`.
- `ChatPane`은 메시지 배열을 state로 들고, 전송 시 대화가 없으면 먼저 생성하고 `router.replace`로 `?c=`를 붙인 뒤 messages 라우트를 `fetch`해 `readNdjson`(`lib/ndjson.ts`)으로 이벤트를 소비한다.
- `ProposalCard`는 [적용]/[취소] 클릭 시 해당 라우트를 부르고 응답 `status`로 카드를 갱신한다. 요청 중에는 두 버튼 모두 비활성.
- 스트림 오류 사유별 문구:
  - `not_configured`: "OpenAI API 키 또는 서비스 계정이 설정되지 않았습니다"
  - `sheet_forbidden`: "시트를 읽을 권한이 없습니다. `{serviceAccountEmail}`에 편집자로 공유했는지 확인하세요"
  - `sheet_not_found`: "시트를 찾을 수 없습니다. 시트 설정의 URL을 확인하세요"
  - `sheet_too_large`: "시트가 너무 큽니다(300,000자 초과)"
  - `model_failed`: "응답을 받지 못했습니다. 다시 시도하세요"
  - `invalid_proposal`: "수정 제안을 만들지 못했습니다. 탭·열 이름을 정확히 알려주고 다시 시도하세요"
- 적용 실패 사유별 문구: `conflict` "시트가 그 사이 바뀌었습니다. 다시 물어봐 주세요", `sheet_write_failed` "시트에 쓰지 못했습니다", `invalid_proposal` "제안이 시트 구조와 맞지 않습니다".

## 환경변수

`.env.example`에 추가:

```
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5-mini
# 운영 시트 어시스턴트가 구글 시트를 읽고 쓰는 서비스 계정 키(JSON 한 줄). 시트를 이 계정의 client_email에 편집자로 공유한다
GOOGLE_SERVICE_ACCOUNT_JSON=
```

## 테스트

기존 `tests/lib`·`tests/api`·`tests/components` 패턴(Vitest, 외부 모듈 mock).

- `tests/lib/sheets.test.ts`: `parseSheetUrl`(URL·순수 ID·잘못된 값), header 판정(빈 칸·중복 → null), `serializeSheets`(행 번호·빈 행 생략·`|` 치환), `validateProposal`(없는 탭·열·행, header 없는 탭), A1 범위 계산, `applyProposal`의 `conflict`(mock한 재읽기 값이 `before`와 다를 때)와 `append` 열 정렬.
- `tests/lib/assistant.test.ts`: `buildAssistantPrompt`에 게임명·날짜·시트 텍스트가 들어가는지, 이력 변환에서 proposal이 상태 문구를 단 텍스트로 바뀌는지, tool call 델타를 모아 `proposal` 이벤트로 내는지(OpenAI 클라이언트 mock).
- `tests/api/assistant-messages.test.ts`: 미인증 401, `sheet_id` 없으면 400, 시트 읽기 실패 시 `error` 한 줄, 정상 흐름에서 user·assistant·proposal 저장과 NDJSON 이벤트 순서.
- `tests/api/assistant-apply.test.ts`: `pending`이 아니면 409, 성공 시 `applied`와 `applied_by`, 실패 시 `failed`와 사유, cancel 전이.
- `tests/api/games-patch.test.ts`: URL → `sheet_id` 저장, 잘못된 URL 400, `serviceAccountEmail` 응답.
- `tests/components/ProposalCard.test.tsx`: 적용 클릭 → fetch 호출 → 상태 문구 갱신, 요청 중 버튼 비활성.

## 설정 절차 (README·CLAUDE.md에 옮길 내용)

1. Google Cloud 콘솔에서 프로젝트 선택 → Google Sheets API 사용 설정 → 서비스 계정 생성 → 키(JSON) 발급.
2. 키 파일 내용을 한 줄로 만들어 `GOOGLE_SERVICE_ACCOUNT_JSON`에 넣는다. `OPENAI_API_KEY`도 넣고 재배포.
3. 마이그레이션 `0018_assistant.sql` 실행.
4. 게임 운영 시트를 만든다. 수정까지 쓰려면 탭 첫 줄에 열 이름을 둔다(예: VIP 탭 = 이메일 / ID / 서버 / 닉네임 / VIP 단계 / 갱신일).
5. 관리자 페이지 → 게임 문의함 → "운영 어시스턴트" → 시트 설정에 URL을 넣고, 안내된 서비스 계정 이메일에 시트를 편집자로 공유한다.
6. "52009 VIP 몇이야"로 읽기, "52009 VIP4로 올려줘"로 제안 카드 → 적용 → 시트 반영을 확인한다.
