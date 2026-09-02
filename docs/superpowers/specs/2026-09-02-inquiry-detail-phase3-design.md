# 문의 상세 개편 3단계 — LLM 답변 추천 · 답변 템플릿

- 날짜: 2026-09-02
- 상태: 승인됨 (구현 계획 작성 대기)
- 선행 문서: `2026-09-02-inquiry-detail-phase1-design.md`, `2026-09-02-inquiry-detail-phase2-design.md`

## 배경 및 목적

1·2단계로 문의 상세 화면은 참고 화면 수준에 도달했다. 남은 것은 답변 작성 자체를 빠르게 만드는 두 기능이다.

1. **답변 템플릿** — 자주 쓰는 답변을 게임별·문의유형별로 저장해 두고 클릭 한 번으로 답변란에 넣는다.
2. **LLM 답변 추천** — Gemini API로 이 문의에 맞는 답변 초안을 생성한다.

둘은 독립 기능처럼 보이지만 묶여 있다. 템플릿이 있으면 LLM에게 "우리 팀은 이런 식으로 답한다"를 알려줄 수 있어 추천 품질이 올라간다. 그래서 템플릿을 먼저 만들고 추천이 그것을 읽는 순서로 간다.

## 범위

**포함:**

- `reply_templates` 테이블 — 게임별, 문의유형(`type_key`) 선택적 연결
- 게임별 템플릿 관리 페이지 (목록 / 추가 / 삭제)
- 문의 상세에서 템플릿을 골라 답변란에 삽입
- Gemini API 답변 추천 — 문의 내용 + 같은 유형의 최근 발송 답변 + 해당 유형 템플릿을 근거로 초안 생성
- 추천 결과를 미리보기로 보여주고 `[적용]` / `[버리기]`

**제외:**

- 템플릿 수정 — 추가와 삭제만. 고칠 일이 있으면 지우고 다시 만든다. 편집 폼을 만들 만큼 자주 바뀌지 않는다.
- 템플릿 정렬 순서 UI — `sort_order` 컬럼은 두되 화면에서 바꾸지 않는다. 생성 순서로 충분하다.
- 추천 결과 후보 여러 개 — 하나만 받는다. 토큰 비용과 대기 시간이 배로 늘고, 미리보기에서 버리고 다시 받으면 되는 일이다.
- 자동 추천 — 상세 화면을 열 때마다 API를 때리지 않는다. 버튼을 눌러야 호출한다.
- 템플릿 관리 페이지로 들어가는 내비게이션 링크 — 아래 "알려진 제약" 참고.

## 알려진 제약: 내비게이션 링크

템플릿 관리 페이지로 들어가는 링크를 달 자연스러운 자리는 `app/(admin)/games/[gameId]/inquiries/page.tsx`의 헤더나 `components/layout/GameRail.tsx`인데, **이 저장소에는 지금 그 두 파일을 포함한 게임 삭제 기능 미커밋 작업이 있다.** 그 작업과 섞이지 않도록 두 파일을 건드리지 않는다.

따라서 이 단계의 결과물은 `/games/[gameId]/templates` URL로 직접 접근 가능하되 화면상 진입 경로가 없다. 미커밋 작업이 정리된 뒤 한 줄을 추가하면 된다:

```tsx
<Link href={`/games/${game.id}/templates`} className="text-sm text-muted hover:text-ink transition-colors">
  답변 템플릿
</Link>
```

## 설계 결정

### 1. 모델은 Gemini 3.5 Flash-Lite

`gemini-3.5-flash-lite`를 쓴다. (`gemini-2.5-flash-lite`로 시작했으나 신규 사용자에게 더 이상 제공되지 않아 404가 났다 — 아래 참고.) 답변 초안 작성은 정형화된 글쓰기 작업이고, 관리자가 결과를 읽고 고친 뒤 발송하므로 모델이 실수해도 사람이 걸러낸다. 최상위 모델을 쓸 이유가 없다.

Google Gen AI SDK(`@google/genai`)를 쓴다. `@google/generative-ai`는 구버전이므로 쓰지 않는다.

```ts
const ai = new GoogleGenAI({ apiKey });
const response = await ai.models.generateContent({
  model: process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite",
  contents: userMessage,
  config: {
    systemInstruction: system,
    maxOutputTokens: 2048,
    temperature: 0.4,
    thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
  },
});
```

- **모델 ID를 환경변수로 덮어쓸 수 있게 둔다.** 모델 이름은 서버 쪽에서 바뀌고, 그때마다 코드를 고치고 배포할 이유가 없다.
- `thinkingLevel: MINIMAL`로 사고량을 낮춘다. **`thinkingBudget: 0`은 이 모델에서 400 INVALID_ARGUMENT다** — 사고를 끌 수는 없고 수준만 낮출 수 있다.
- `temperature: 0.4` — 템플릿 말투를 따라야 하므로 창의성보다 일관성 쪽으로 둔다.
- 스트리밍은 쓰지 않는다. 미리보기 UI라 부분 출력을 보여줄 이유가 없다.

**응답 해석:** 본문은 `response.text` 게터로 얻는다. 차단은 예외가 아니라 정상 응답으로 돌아오므로 `response.candidates?.[0]?.finishReason`이 `SAFETY` 또는 `RECITATION`인지, 그리고 `response.text`가 비었는지를 확인해야 한다.

### 2. 프롬프트 조립은 순수 함수로 분리한다

`buildSuggestPrompt(input): { system: string; userMessage: string }`을 순수 함수로 두고, Gemini 호출은 얇은 껍데기가 감싼다. 프롬프트가 이 기능의 핵심 로직인데 API를 때려야만 테스트할 수 있으면 아무도 고치지 못한다.

프롬프트에 넣는 것:

- 게임 이름, 문의 종류·유형(한국어 라벨)
- 문의 제목과 본문
- 게임 계정, 회사명 (있으면)
- 해당 유형의 **템플릿** 전부
- 같은 유형의 **최근 발송 답변 3건** (`reply_content is not null`, 최신순)

넣지 않는 것: 회신 이메일(불필요한 개인정보), 첨부파일, 계정 이력. 계정 이력은 유용해 보이지만 프롬프트를 길게 만드는 데 비해 답변 초안 품질에 기여하는 바가 불확실하다. 필요해지면 넣는 건 쉽다.

시스템 프롬프트가 못 박아야 할 것:

- 한국어로, 고객에게 보내는 메일 본문만 출력 (머리말·설명·따옴표 없이)
- **모르는 것을 지어내지 말 것.** 보상 지급, 환불 승인, 일정 확정처럼 확인이 필요한 약속은 하지 말고 "확인 후 안내드리겠습니다" 식으로 남길 것
- 템플릿이 있으면 그 말투와 구조를 따르되, **템플릿 제목을 본문에 옮겨 적지 말 것** (실제로 첫 줄에 `[환불 안내]`가 나왔다)
- 서명은 붙이지 말 것 (발송 시스템이 처리)

### 3. 추천 실패는 답변 작성을 막지 않는다

CLAUDE.md의 "부가 작업 실패가 핵심 데이터 저장을 막지 않는다" 규칙이 여기에도 적용된다. 추천은 편의 기능이다. `GEMINI_API_KEY`가 없거나, 요청이 실패하거나, 모델이 안전 필터로 차단(`finishReason: "SAFETY"`)해도 답변란은 그대로 쓸 수 있어야 한다. 화면은 에러 문구만 띄우고 아무것도 잠그지 않는다.

`GEMINI_API_KEY` 미설정은 Gmail과 같은 취급이다 — 라우트가 500과 `error: "not_configured"`를 돌려주고, 화면이 "API 키가 설정되지 않았습니다"를 띄운다. 다른 실패와 구분해야 관리자가 무엇을 고쳐야 할지 안다.

### 4. 추천은 이력에 남기지 않는다

`inquiry_events`에 쌓지 않는다. 추천은 초안 생성일 뿐 문의 상태를 바꾸지 않고, 여러 번 눌릴 수 있어 이력이 도배된다. 실제로 나간 답변은 `reply_sent`로 이미 기록된다.

### 5. 템플릿은 삭제 시 실제로 지운다

soft delete를 쓰지 않는다. 템플릿은 감사 대상이 아니고, 이미 발송된 답변은 `reply_content`에 본문이 그대로 남아 있어 템플릿이 사라져도 기록이 손상되지 않는다.

## 스키마 (`supabase/migrations/0004_reply_templates.sql`)

```sql
create table if not exists reply_templates (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references games(id) on delete cascade,
  type_key   text,
  title      text not null,
  content    text not null,
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists reply_templates_game_id_idx on reply_templates (game_id, sort_order, created_at);

alter table reply_templates enable row level security;
```

`type_key`가 `null`이면 그 게임의 모든 유형에 쓰이는 공용 템플릿이다. `inquiry_types`에 FK를 걸지 않는다 — `inquiry_types`는 `(group_id, key)`로 식별되고 `inquiries` 자신도 `type_key`를 문자열로만 들고 있어, 여기만 FK를 거는 것은 일관성을 해친다.

RLS를 켜고 정책은 두지 않는다. 2단계의 `inquiry_notes` / `inquiry_events`와 같다 — service-role만 접근하고 트리거가 없으니 `security definer`도 필요 없다.

## 애플리케이션 변경

### 의존성

```
npm install @google/genai
```

`.env.example`에 `GEMINI_API_KEY=`와 `GEMINI_MODEL=gemini-3.5-flash-lite` 추가. 후자는 선택이며 비어 있으면 기본값을 쓴다.

### `lib/templates.ts` (신규)

```ts
export interface TemplateRow { id: string; typeKey: string | null; title: string; content: string }
export async function listTemplates(supabase, gameId): Promise<TemplateRow[]>
export async function createTemplate(supabase, input: { gameId; typeKey; title; content }): Promise<boolean>
export async function deleteTemplate(supabase, id): Promise<boolean>
```

메모와 같이 성공 여부를 돌려준다. 사용자가 방금 만든 템플릿이 조용히 사라지면 안 된다.

조회는 게임 단위로 전부 가져오고 유형별 필터는 화면에서 한다. 게임 하나당 템플릿이 수십 개를 넘을 일이 없다.

### `lib/suggest.ts` (신규)

```ts
export interface SuggestInput {
  gameName: string;
  groupLabel: string;
  typeLabel: string;
  title: string;
  content: string;
  gameAccount: string | null;
  companyName: string | null;
  templates: Array<{ title: string; content: string }>;
  pastReplies: string[];
}

export function buildSuggestPrompt(input: SuggestInput): { system: string; userMessage: string }
export async function requestSuggestion(input: SuggestInput): Promise<
  | { ok: true; text: string }
  | { ok: false; reason: "not_configured" | "refused" | "failed" }
>
```

`buildSuggestPrompt`가 테스트 대상이다. `requestSuggestion`은 SDK 호출과 응답 해석만 한다.

차단 여부를 반드시 확인한다 — 안전 필터에 걸려도 예외가 아니라 정상 응답으로 돌아온다. `response.candidates?.[0]?.finishReason`이 `SAFETY`/`RECITATION`이거나 `response.text`가 비어 있으면 `refused`로 처리한다.

### `lib/replies.ts` (신규)

```ts
export async function listRecentRepliesByType(supabase, gameId, typeKey, limit): Promise<string[]>
```

같은 게임·같은 유형에서 이미 발송된 답변 본문을 최신순으로 가져온다. `lib/inquiries.ts`에 넣지 않는 이유는 그 파일이 이미 커졌고, 이건 추천 기능만 쓰는 조회이기 때문이다.

### API 라우트

| 라우트 | 동작 |
|---|---|
| `POST /api/games/[gameId]/templates` (신규) | 템플릿 추가 |
| `DELETE /api/templates/[id]` (신규) | 템플릿 삭제 |
| `POST /api/inquiries/[id]/suggest` (신규) | 추천 생성. `{ success: true, suggestion }` 또는 `{ success: false, error }` |

추천 라우트의 에러 코드: `unauthorized` / `not_found` / `not_configured` / `refused` / `failed`.

템플릿 삭제를 `/api/templates/[id]`에 두는 이유: 삭제에 필요한 것은 템플릿 id뿐이고, `/api/games/[gameId]/templates/[id]`로 중첩하면 gameId가 검증에도 쓰이지 않으면서 URL만 길어진다.

### 화면

| 파일 | 책임 |
|---|---|
| `app/(admin)/games/[gameId]/templates/page.tsx` (신규) | 템플릿 관리 페이지 |
| `components/templates/TemplateManager.tsx` (신규, client) | 목록 + 추가 폼 + 삭제 |
| `components/inquiries/TemplatePicker.tsx` (신규, client) | 답변 카드 안. 해당 유형 + 공용 템플릿을 드롭다운으로 |
| `components/inquiries/SuggestButton.tsx` (신규, client) | `[AI 답변 추천]` 버튼, 결과 미리보기, `[적용]`/`[버리기]` |
| `components/inquiries/ReplyForm.tsx` (수정) | 위 둘을 품고, 삽입·적용 시 textarea 내용을 갱신 |

`ReplyForm`이 답변 본문 상태를 들고 있으므로 템플릿 삽입과 추천 적용은 모두 `ReplyForm`이 소유한다. `TemplatePicker`와 `SuggestButton`은 값을 위로 올려주기만 하는 자식이다.

**삽입 규칙:** 템플릿 삽입과 추천 적용 모두 **덮어쓰지 않고** 확인을 거친다 — textarea가 비어 있으면 그냥 넣고, 이미 내용이 있으면 "작성 중인 내용을 대체합니다" 경고 문구를 버튼 옆에 띄운 뒤 다시 누르면 대체한다. 브라우저 `confirm()`은 쓰지 않는다.

## 테스트 계획

TDD로 진행한다.

신규:

- `tests/lib/suggest.test.ts` — `buildSuggestPrompt`가 게임명·유형·본문·템플릿·과거 답변을 모두 담는지, 템플릿/과거 답변이 없을 때 해당 절이 통째로 빠지는지, 시스템 프롬프트가 "지어내지 말 것" 지시를 담는지
- `tests/lib/templates.test.ts` — 조회 매핑, 생성 인자, 실패 시 `false`
- `tests/lib/replies.test.ts` — 게임·유형 필터, `reply_content is not null`, limit
- `tests/api/template-create.test.ts` / `tests/api/template-delete.test.ts` — 401 / 400 / 500 / 성공
- `tests/api/inquiry-suggest.test.ts` — 401 / not_found / **not_configured** / **refused**(안전 필터 차단) / 성공
- `tests/components/TemplateManager.test.tsx` — 빈 상태, 목록, 추가, 삭제, 실패 시 에러
- `tests/components/TemplatePicker.test.tsx` — 유형 일치 + 공용만 보이는지, 선택 시 콜백
- `tests/components/SuggestButton.test.tsx` — 호출, 미리보기 표시, 적용/버리기, 실패 문구

기존 수정:

- `tests/components/ReplyForm.test.tsx` — 새 props, 빈 textarea에 삽입, 내용이 있을 때 경고 후 2회 클릭으로 대체

**Gemini API는 실제로 호출하지 않는다.** `@google/genai`를 `vi.mock`으로 대체한다. 테스트가 돈을 쓰거나 네트워크에 의존해서는 안 된다.

## 가정

- `GEMINI_API_KEY`는 사람이 `.env`에 넣는다. 없으면 추천 버튼만 실패하고 나머지는 정상 동작한다.
- 모델 ID는 실제 호출로 검증했다. 처음 지정한 `gemini-2.5-flash-lite`는 신규 사용자에게 제공되지 않아 404가 났고, Google이 안내한 `gemini-3.5-flash-lite`로 교체했다. `GEMINI_MODEL` 환경변수로 코드 수정 없이 다시 바꿀 수 있다.
- 템플릿은 게임당 수십 개 수준. 페이지네이션하지 않는다.
- 마이그레이션은 사람이 Supabase에 직접 적용한다.
