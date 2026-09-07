# 운영 어시스턴트 자료 연결(시트·문서 여러 개) 설계

작성일: 2026-09-07. `2026-09-04-sheet-assistant-design.md`의 후속으로, 그 문서의 "시트 연결" 부분을 대체한다.

## 배경

운영 어시스턴트는 게임당 구글 스프레드시트 하나(`games.sheet_id`)만 연결한다. 운영 담당자는 시트 외에 운영 가이드·정책·이벤트 안내 같은 줄글 문서도 참고하며, 시트도 용도별로 나뉘어 있을 수 있다. 어시스턴트가 이 자료들을 함께 근거로 삼게 하고, 무엇이 연결돼 있는지 화면에서 바로 보이게 한다.

## 결정 사항 (2026-09-07)

- 자료 종류: **구글 스프레드시트**와 **구글 문서(Google Docs)** 두 가지. Word 파일 업로드는 하지 않는다.
- 개수: 게임당 시트·문서 모두 **여러 개**. `games.sheet_id`는 새 표 `assistant_sources`로 옮기고 없앤다.
- 문서는 **읽기 전용**이다. 수정 제안 도구는 시트에만 붙는다.
- 접근은 기존 서비스 계정 그대로. 문서도 그 계정에 공유해야 한다(뷰어면 충분하지만 안내는 편집자로 통일).
- 검색 방식은 그대로다. 연결된 자료 전부를 매번 읽어 프롬프트에 싣는다. 합계 30만 자 제한.
- 자료 제목은 **등록 시점에 구글에서 가져와 저장**한다. 페이지를 그릴 때 API를 부르지 않는다. 등록 시 읽기가 실패하면(공유 안 됨·잘못된 ID) 등록을 거절해 원인을 바로 알린다.

## 목표

- 사이드바에서 연결된 자료 목록이 보이고, 추가·삭제·열기가 그 자리에서 된다.
- 여러 시트·문서를 근거로 답하고, 근거 표기에 자료 이름이 들어간다.
- 수정 제안은 어느 시트인지 확정된 채 저장되고 적용된다. 탭 이름이 시트끼리 겹쳐도 섞이지 않는다.
- 자료 하나가 읽기에 실패하면 어느 자료인지 화면이 알려준다.

## 범위 밖

- 문서 수정. Docs API 쓰기는 하지 않는다.
- Word(.docx)·PDF 업로드, 구글 드라이브 폴더 연결.
- 자료별 켜고 끄기, 순서 바꾸기. 등록 순서대로 싣는다.
- 자료 제목 자동 갱신. 구글에서 이름을 바꾸면 삭제 후 다시 등록한다.

## 데이터 모델 (마이그레이션 0019 — 0018은 첨부 파일용으로 이미 쓰였다)

```sql
create table if not exists assistant_sources (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references games(id) on delete cascade,
  kind         text not null check (kind in ('sheet', 'doc')),
  external_id  text not null,
  title        text not null,
  created_at   timestamptz not null default now(),
  unique (game_id, kind, external_id)
);
create index if not exists assistant_sources_game_idx on assistant_sources (game_id, created_at);
alter table assistant_sources enable row level security;

-- 기존 시트 연결을 옮긴다. 제목은 실제 이름을 모르니 '운영 시트'로 두고, 화면에서 삭제 후 재등록하면 실제 제목이 들어간다.
insert into assistant_sources (game_id, kind, external_id, title)
select id, 'sheet', sheet_id, '운영 시트' from games where sheet_id is not null
on conflict do nothing;

alter table games drop column if exists sheet_id;
```

`lib/categories.ts`의 `Game.sheetId`는 없앤다. 0017가 anon에 준 열 단위 `select` 권한은 `sheet_id`를 포함하지 않으므로 그대로 둔다.

### 제안(proposal) JSON

기존 두 형태에 `sourceId`(자료 id)와 `sourceTitle`(표시용)을 더한다.

```ts
type Proposal =
  | { kind: "update"; sourceId: string; sourceTitle: string; sheet: string; row: number; updates: ProposalUpdate[] }
  | { kind: "append"; sourceId: string; sourceTitle: string; sheet: string; values: Record<string, string> };
```

0019 이전에 저장된 `pending` 제안은 `sourceId`가 없다. 적용 라우트는 이를 `invalid_proposal`로 실패시킨다. 개발 중 데이터뿐이라 별도 변환은 하지 않는다.

## 자료 읽기

### 저장소 — `lib/assistant-sources.ts` (신규)

```ts
type SourceKind = "sheet" | "doc";
interface SourceRow { id: string; gameId: string; kind: SourceKind; externalId: string; title: string; createdAt: string }

listSources(supabase, gameId): Promise<SourceRow[]>          // created_at 오름차순
getSource(supabase, id): Promise<SourceRow | null>
insertSource(supabase, { gameId, kind, externalId, title }): Promise<SourceRow | null | "duplicate">
deleteSource(supabase, gameId, id): Promise<boolean>
parseSourceUrl(input): { kind: SourceKind; externalId: string } | null
```

`parseSourceUrl`은 `/spreadsheets/d/{id}` → sheet, `/document/d/{id}` → doc. 순수 ID만 오면 종류를 알 수 없으므로 null(대화상자가 "URL 전체를 붙여넣으세요"로 안내).

### 시트 — `lib/sheets.ts`

- `readSpreadsheet(sheetId)`는 그대로. 추가로 `readSpreadsheetTitle(sheetId): Promise<string>`을 둔다(`spreadsheets.get` `fields=properties.title`). 오류 매핑은 `readSpreadsheet`와 같다.
- `prepareProposal(tabs, raw)`와 `validateProposal`은 그대로 한 스프레드시트의 탭 배열로 동작한다. 자료 선택은 호출자가 한다.
- `SheetErrorReason`은 유지한다. 문서 읽기도 같은 사유 집합을 쓰되 이름을 일반화한다: `sheet_forbidden` → `source_forbidden`, `sheet_not_found` → `source_not_found`, `sheet_too_large` → `sources_too_large`, `sheet_read_failed` → `source_read_failed`. `sheet_write_failed`·`invalid_proposal`·`conflict`·`not_configured`는 그대로. `SheetError`는 `sourceTitle?: string`을 선택 필드로 갖는다.

### 문서 — `lib/docs.ts` (신규)

- 인증: `lib/sheets.ts`의 서비스 계정 로더를 `lib/google-auth.ts`로 빼서 둘이 같이 쓴다. JWT 스코프는 `spreadsheets`와 `documents.readonly` 두 개.
- `readDocument(docId): Promise<{ title: string; text: string }>`. Docs API `documents.get`으로 받은 본문을 `serializeDocument(document)`(순수 함수)로 텍스트화한다.
  - `paragraph`: 각 `textRun.content`를 이어 붙이고 끝의 개행을 정리해 한 줄. 빈 문단은 건너뛴다. 제목 스타일(`HEADING_1`~`HEADING_3`)은 앞에 `#`·`##`·`###`을 붙인다. 글머리 기호가 있으면 `- `를 붙인다.
  - `table`: 행마다 셀 텍스트를 `" | "`로 잇는다. 셀 안 개행은 공백으로.
  - `sectionBreak`·`tableOfContents`·그림은 건너뛴다.
- 오류 매핑은 시트와 같다(403 → `source_forbidden`, 404 → `source_not_found`, 그 외 `source_read_failed`).

### 한 번에 읽기 — `lib/assistant-sources.ts`

```ts
interface LoadedSource =
  | { source: SourceRow; kind: "sheet"; tabs: SheetTab[] }
  | { source: SourceRow; kind: "doc"; text: string };

loadSources(sources: SourceRow[]): Promise<LoadedSource[]>
serializeSources(loaded: LoadedSource[]): string
```

- `loadSources`는 `Promise.all`로 병렬 읽기. 하나라도 실패하면 그 `SheetError`에 `sourceTitle`을 채워 다시 던진다. 모두 읽은 뒤 합계 글자 수가 `MAX_SHEET_CHARS`(30만)를 넘으면 `sources_too_large`.
- `serializeSources`는 자료마다 구간을 만든다. 시트는 `# 시트: {title}` 아래에 기존 `serializeSheets` 결과(탭은 `## 탭명`). 문서는 `# 문서: {title}` 아래에 본문. 구간 사이는 빈 줄 두 개.

## 프롬프트와 도구 — `lib/assistant.ts`

- `buildAssistantPrompt({ gameName, today, sourcesText })`. 규칙 문구를 바꾼다.
  - "답할 때 근거가 된 자료를 짧게 덧붙이세요. 시트는 `VIP 시트 VIP 탭 7행`, 문서는 `운영 가이드 문서`처럼."
  - "시트는 propose_update/propose_append로 수정을 제안할 수 있고, 문서는 읽기만 합니다. 문서를 고치자고 하면 직접 수정해야 한다고 안내하세요."
  - 나머지 규칙(추측 금지·행 번호·되묻기·오늘 날짜)은 유지.
- 두 도구에 `spreadsheet: string`(시트 제목, 필수) 인자를 더한다. 설명: "`# 시트:` 뒤에 적힌 시트 제목".
- `streamAssistant({ system, history, sources })`. 도구 호출을 검증할 때 `spreadsheet`로 `LoadedSource`(kind sheet)를 제목으로 찾고, 없으면 `invalid_proposal`. 찾으면 그 `tabs`로 `prepareProposal`하고 결과에 `sourceId`·`sourceTitle`을 붙인다. 시트 제목이 같은 자료가 둘이면 먼저 등록된 것을 쓴다(등록 화면에서 같은 제목을 막지는 않는다).
- 이력 변환의 `describeProposal`은 "시트 수정 제안: {sourceTitle} 시트 {sheet} 탭 …"으로 자료 이름을 넣는다.

## API

모두 관리자 세션 필수. 실패 응답은 `{ success: false, error }`.

| 메서드·경로 | 본문 | 동작 |
|---|---|---|
| `POST /api/games/[gameId]/sources` | `{ url }` | `parseSourceUrl` 실패 → `invalid_input` 400. 게임 없음 → `not_found` 404. 종류별로 제목을 읽는다(`readSpreadsheetTitle` / `readDocument`). `SheetError`면 그 사유를 200으로 `{ success: false, error: reason }`(설정·공유 문제라 화면이 사유별 문구를 띄운다). 저장 시 unique 충돌 → `duplicate` 409. 성공 `{ success: true, source }` |
| `DELETE /api/games/[gameId]/sources/[sourceId]` | | 그 게임의 자료만 지운다. 없으면 404 |

- `PATCH /api/games/[gameId]`의 `sheetUrl` 처리와 `tests/api/game-sheet.test.ts`는 삭제한다. 다른 PATCH 용도가 없으면 핸들러 자체를 없앤다.
- 메시지 라우트(`POST /api/assistant/conversations/[id]/messages`): 자료가 없으면 `not_configured` 400. `listSources` → `loadSources` → 실패 시 NDJSON `{ type: "error", reason, sourceTitle? }` 한 줄. 성공 시 `serializeSources` → 프롬프트 → 스트림. 나머지 순서는 기존과 같다.
- 적용 라우트(`POST /api/assistant/messages/[id]/apply`): `proposal.sourceId`로 `getSource`. 없거나 kind가 sheet가 아니거나 다른 게임이면 `invalid_proposal`로 실패 처리. 있으면 `applyProposal(source.externalId, proposal)`.

## 화면 — `components/assistant/`

### 사이드바 `ConversationSidebar`

게임 이름 아래, "+ 새 대화" 위에 "연결된 자료" 구역:

```
여신 키우기            운영 어시스턴트
연결된 자료
 ▦ VIP·보상 원장                ✕
 ▤ 운영 가이드                  ✕
 + 자료 추가
─────────────────────────
 + 새 대화
```

- 행: 종류 아이콘(시트 ▦ / 문서 ▤, `aria-label` "시트"/"문서") + 제목. 링크는 새 탭(`target="_blank" rel="noopener"`)으로 `https://docs.google.com/spreadsheets/d/{id}/edit` 또는 `https://docs.google.com/document/d/{id}/edit`.
- ✕는 호버·포커스 시 보이고 `aria-label="{제목} 연결 해제"`. 클릭 → DELETE → `router.refresh()`. 확인 대화상자는 없다(대화 삭제와 같은 방식).
- 자료가 없으면 목록 자리에 "연결된 자료가 없습니다" 한 줄.
- "+ 자료 추가"가 `SourceAddDialog`를 연다. 하단의 "⚙ 시트 설정" 버튼은 없앤다.

### 자료 추가 대화상자 `SourceAddDialog` (`SheetSettingsDialog` 대체)

- 제목 "자료 추가". 입력 하나("구글 시트 또는 문서 URL"), 안내 박스는 기존 서비스 계정 안내를 유지하되 "시트·문서를 아래 서비스 계정에 편집자로 공유하세요"로 바꾼다.
- 저장 → POST. 응답 사유별 문구:
  - `invalid_input`: "구글 시트 또는 문서의 URL 전체를 붙여넣으세요."
  - `source_forbidden`: "읽을 권한이 없습니다. 위 서비스 계정에 먼저 공유한 뒤 다시 시도하세요."
  - `source_not_found`: "자료를 찾을 수 없습니다. URL을 확인하세요."
  - `duplicate`: "이미 연결된 자료입니다."
  - `not_configured`: "서비스 계정이 설정되지 않았습니다."
  - 그 외: "저장하지 못했습니다."
- 성공 시 `router.refresh()` 후 닫는다.

### `AssistantShell`

props의 `game.sheetId` 대신 `sources: SourceRow[]`를 받는다. 자료가 하나도 없으면 대화 영역에 "이 게임에 연결된 자료가 없습니다" + "자료 추가하기" 버튼(대화상자 열기). 하나라도 있으면 `ChatPane`.

### `ProposalCard`

헤더를 "시트 수정 제안 · {sourceTitle} · {sheet} 탭 7행"으로.

### 오류 문구 `messages.ts`

- 스트림: `source_forbidden` "'{sourceTitle}'을(를) 읽을 권한이 없습니다. 서비스 계정에 공유했는지 확인하세요.", `source_not_found` "'{sourceTitle}'을(를) 찾을 수 없습니다. 연결을 해제하고 다시 추가하세요.", `sources_too_large` "연결된 자료가 너무 큽니다(합계 300,000자 초과).", `source_read_failed` "'{sourceTitle}'을(를) 읽지 못했습니다. 잠시 후 다시 시도하세요." `sourceTitle`이 없으면 "자료"로 대신한다. 문구 생성은 `streamErrorMessage(reason, sourceTitle?)` 함수로.
- 적용 실패: `invalid_proposal` 문구를 "제안이 시트 구조와 맞지 않거나 시트 연결이 해제됐습니다."로.

## 페이지 `app/(assistant)/games/[gameId]/assistant/page.tsx`

`listConversations`와 `listSources`를 `Promise.all`로 함께 조회해 `AssistantShell`에 넘긴다.

## 문서·설정

- CLAUDE.md 8번 항목과 "운영 시트 어시스턴트 설정 절차"를 갱신: 시트·문서 여러 개, Cloud 콘솔에서 "Google Docs API"도 사용 설정, 0019 실행.
- `.env.example`의 `GOOGLE_SERVICE_ACCOUNT_JSON` 주석에 "문서도 이 계정에 공유"를 덧붙인다.

## 테스트

- `tests/lib/assistant-sources.test.ts`: `parseSourceUrl`(시트·문서 URL, 순수 ID 거절), `serializeSources`(시트·문서 구간 제목, 순서), `loadSources`(병렬 호출, 실패 시 `sourceTitle` 채움, 합계 초과 → `sources_too_large`), 저장소 함수(supabase mock).
- `tests/lib/docs.test.ts`: `serializeDocument`(문단·제목·글머리·표·빈 문단 생략), `readDocument` 오류 매핑(googleapis mock).
- `tests/lib/sheets.test.ts`: `readSpreadsheetTitle` 추가. 사유 이름 변경 반영.
- `tests/lib/assistant.test.ts`: 프롬프트에 자료 텍스트·규칙 문구, 도구의 `spreadsheet`로 자료를 고르고 `sourceId`가 붙는지, 모르는 시트 제목 → `invalid_proposal`.
- `tests/api/game-sources.test.ts`(`game-sheet.test.ts` 대체): 401, 잘못된 URL 400, 공유 안 됨 → `source_forbidden`, 중복 409, 성공 시 제목 저장, DELETE 다른 게임 자료 404.
- `tests/api/assistant-messages.test.ts`: 자료 없음 400, 한 자료 실패 시 `error`에 `sourceTitle`, 정상 흐름에서 프롬프트에 두 자료가 실리는지.
- `tests/api/assistant-apply.test.ts`: `sourceId`로 자료를 찾아 `applyProposal`에 그 시트 ID를 넘기는지, 자료가 없으면 `invalid_proposal`.
- `tests/components/ConversationSidebar.test.tsx`: 자료 행 링크·아이콘, 빈 목록 문구, ✕ 클릭 시 DELETE.
- `tests/components/SourceAddDialog.test.tsx`: 사유별 문구.
- `tests/components/AssistantShell.test.tsx`: `sources` props로 갱신.

## 설정 절차 (CLAUDE.md에 옮길 내용)

1. Google Cloud 콘솔 → 프로젝트 → "Google Sheets API"와 "Google Docs API" 사용 설정 → 서비스 계정 키(JSON).
2. `GOOGLE_SERVICE_ACCOUNT_JSON`, `OPENAI_API_KEY` 설정 후 재배포.
3. Supabase SQL Editor에서 `0015_assistant.sql`, `0017_assistant_sources.sql` 순서로 실행.
4. 관리자 페이지 → 게임 문의함 → "운영 어시스턴트" → "+ 자료 추가"에 시트·문서 URL을 넣는다. 그 전에 안내된 서비스 계정 이메일에 각 자료를 편집자로 공유한다.
5. 시트는 "52009 VIP 몇이야" → "52009 VIP4로 올려줘" → 제안 카드 → [적용]. 문서는 "환불 정책이 뭐야"처럼 물어 근거에 문서 이름이 붙는지 확인한다.
