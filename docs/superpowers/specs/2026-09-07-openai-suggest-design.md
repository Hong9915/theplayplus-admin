# AI 답변 추천 개편(OpenAI 전환 · 유사 답변 검색 · 운영 자료 근거) 설계

작성일: 2026-09-07. `2026-09-02-inquiry-detail-phase3-design.md`의 "AI 답변 추천" 절을 대체한다. 운영 어시스턴트(`2026-09-04-sheet-assistant-design.md`, `2026-09-07-assistant-sources-design.md`)의 자료 로더와 OpenAI 클라이언트를 재사용한다.

## 배경

답변 추천은 지금 Gemini로 돌고, 근거로 "같은 게임·같은 유형의 최근 답변 3건"과 유형 템플릿만 넣는다. 유형 분류가 틀리거나 그 유형에 답변이 적으면 근거가 비고, 이벤트 기간·지급 기준처럼 운영 시트에만 있는 사실은 모델이 모른다. 운영 어시스턴트가 이미 OpenAI와 구글 시트·문서 로더를 갖췄으니 추천도 그 위에 얹는다.

## 결정 사항 (2026-09-07)

- 모델 제공자: **OpenAI**로 바꾸고 Gemini(`@google/genai`, `GEMINI_*`)는 제거한다. 채팅 모델은 어시스턴트와 같은 `OPENAI_MODEL`(기본 `gpt-5-mini`).
- 과거 답변 근거: 문의 본문을 **임베딩(`text-embedding-3-small`, 1536차원, pgvector)** 해 두고, 새 문의와 **같은 스코프(게임 하나 또는 서비스 문의) 안에서** 내용이 비슷한 과거 문의의 답변을 꺼낸다. 다른 게임은 보지 않는다.
- 운영 자료: 게임 문의면 어시스턴트에 연결된 **시트·문서 전부를 매번 읽어 프롬프트에 싣는다**(조각 임베딩 없음, 합계 30만 자 상한은 어시스턴트와 공유). 서비스 문의는 자료가 없다.
- 근거 표기: 모델이 본문 뒤에 구분선을 두고 참고한 자료를 적는다. 화면은 본문만 적용하고 근거는 미리보기 아래에 보여준다.
- 브랜치: `feat/sheet-assistant` 위에서 시작한다(`feat/openai-suggest`). 어시스턴트 마이그레이션 0015~0017은 main의 0015(번역)·0016(자동답변 지연, 미커밋)과 번호가 겹치므로 **0017~0019로 옮기고**, 임베딩은 **0021**이다.

## 목표

- "AI 답변 추천"을 누르면 OpenAI가 유사 과거 답변·유형 템플릿·운영 자료를 근거로 답변 초안을 스트리밍한다.
- 자료에 있는 사실(이벤트 기간, 지급 기준, 정책)은 답변에 쓰고, 없는 사실은 지어내지 않는다.
- 관리자가 어떤 자료·과거 답변을 참고했는지 미리보기에서 바로 본다.
- 임베딩이 아직 없는 문의(백필 전)나 자료 읽기 실패 때도 추천은 나온다. 막히는 건 API 키 없음뿐이다.

## 범위 밖

- 시트·문서 조각 임베딩(RAG). 자료가 상한에 가까워지면 그때 검토한다.
- 사용자 회신·내부 메모를 근거로 넣기. 문의 원문과 첫 답변만 쓴다.
- 임베딩 모델 교체 시 자동 재계산 잡. 모델명이 다르면 다음 추천·발송 때 그 문의만 다시 계산한다.
- 추천 결과 저장·이력. 지금처럼 초안일 뿐이고 이력에 남기지 않는다.

## 마이그레이션 번호 정리 (첫 커밋)

`feat/sheet-assistant`의 파일을 이름만 바꾼다. 내용은 그대로.

| 지금 | 바꾼 뒤 |
|---|---|
| `0015_assistant.sql` | `0017_assistant.sql` |
| `0016_assistant_attachments.sql` | `0018_assistant_attachments.sql` |
| `0017_assistant_sources.sql` | `0019_assistant_sources.sql` |

파일 안 주석과 `CLAUDE.md`, 두 어시스턴트 스펙, `docs/superpowers/plans/`의 번호 언급("마이그레이션 0015", "0016은 첨부 파일용", "0017 이전에 저장된 제안")도 같이 고친다. 이미 0015~0017로 적용된 DB가 있으면 파일 이름만 바뀐 것이므로 다시 실행하지 않는다(모두 `if not exists`라 실행해도 무해).

## 데이터 모델 (마이그레이션 0021 `0021_inquiry_embeddings.sql`)

```sql
create extension if not exists vector with schema extensions;

alter table inquiries add column if not exists embedding extensions.vector(1536);
-- 어떤 모델로 만든 벡터인지. 모델이 바뀌면 값이 달라 다시 계산한다.
alter table inquiries add column if not exists embedding_model text;

create index if not exists inquiries_embedding_idx
  on inquiries using hnsw (embedding extensions.vector_cosine_ops);
```

anon(접수 폼)에는 열 단위 select 권한만 있어 새 열은 노출되지 않는다.

### RPC `match_answered_inquiries`

```sql
create or replace function match_answered_inquiries(
  p_game_id uuid,                 -- null이면 서비스 문의
  p_query extensions.vector(1536),
  p_exclude_id uuid,              -- 지금 추천 중인 문의
  p_limit int default 5,
  p_min_similarity float default 0.35
) returns table (
  id uuid, inquiry_no text, title text, content text, reply_body text, similarity float
) language sql stable as $$
  select * from (
    select i.id, i.inquiry_no, i.title, i.content,
      coalesce(
        (select m.body from inquiry_messages m
          where m.inquiry_id = i.id and m.direction = 'outbound' and m.auto_sent = false
          order by m.sent_at limit 1),
        i.reply_content
      ) as reply_body,
      1 - (i.embedding <=> p_query) as similarity
    from inquiries i
    where i.embedding is not null
      and i.reply_content is not null
      and i.id <> p_exclude_id
      and ((p_game_id is null and i.game_id is null) or i.game_id = p_game_id)
    order by i.embedding <=> p_query
    limit p_limit
  ) ranked
  where similarity >= p_min_similarity
$$;
```

답변 본문은 **첫 수동 답변**이다(자동 발송 매크로 `auto_sent = true`는 제외). 문의 원문에 대응하는 답이 첫 답변이고, 뒤의 답변은 회신에 대한 것이라서다. 메시지 표가 비어 있으면 `reply_content`.

## 임베딩 — `lib/embeddings.ts` (신규)

```ts
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
/** 임베딩 입력 상한(글자). 한국어는 글자당 1토큰 가까이 쓰므로 8191토큰 상한의 절반 아래로 둔다. */
export const EMBEDDING_MAX_CHARS = 4000;

/** 제목 + 빈 줄 + 본문. 상한을 넘으면 뒤를 자른다. 순수 함수. */
export function inquiryEmbeddingText(inquiry: { title: string; content: string }): string;

/** OpenAI embeddings 호출. 키가 없으면 EmbeddingError("not_configured"), 실패는 EmbeddingError("failed"). */
export async function embedText(text: string): Promise<number[]>;

/**
 * 문의의 임베딩을 돌려준다. 저장된 것이 있고 모델이 같으면 그대로, 아니면 계산해
 * inquiries.embedding / embedding_model에 저장한다. 어떤 실패도 null로 돌려준다 —
 * 호출부(추천·발송)가 막히면 안 된다.
 */
export async function ensureInquiryEmbedding(
  supabase: SupabaseClient,
  inquiry: { id: string; title: string; content: string }
): Promise<number[] | null>;
```

`ensureInquiryEmbedding`은 `inquiries`에서 `embedding, embedding_model`을 읽는다. supabase-js는 vector를 `"[0.1,0.2,…]"` 문자열로 돌려주므로 `JSON.parse`로 배열을 만든다. 저장은 배열을 그대로 `update({ embedding, embedding_model })`로 넘긴다(PostgREST가 vector로 변환).

### 저장 시점

- **추천 버튼을 누를 때**: 라우트가 `ensureInquiryEmbedding`을 부른다. 그 문의는 아직 답변이 없어 검색 결과에는 안 나오지만, 나중에 답변이 붙으면 바로 근거가 된다.
- **수동 답변 발송 시**: `lib/send-reply.ts`의 manual 경로가 기록(`createOutboundMessage`) 뒤에 `ensureInquiryEmbedding`을 `await`하고 실패는 무시한다. 자동 발송 경로는 부르지 않는다.
- **백필**: `scripts/backfill-inquiry-embeddings.js`(아래).

## 유사 답변 조회 — `lib/replies.ts`

```ts
export interface PastReply {
  /** 유사도 검색으로 찾은 경우에만 채워진다. 최근 답변 대체 경로에서는 null. */
  inquiryNo: string | null;
  title: string | null;
  /** 과거 문의 본문 앞 500자. 모델이 "어떤 문의에 이렇게 답했는지" 보게 한다. */
  excerpt: string | null;
  reply: string;
}

export async function listSimilarAnsweredReplies(
  supabase, scope: InboxScope, embedding: number[], excludeId: string, limit = 5
): Promise<PastReply[]>;   // RPC 호출. 오류·빈 결과는 []
export async function listRecentRepliesByType(...)   // 유지. 반환은 string[] 그대로
```

라우트가 둘을 합친다: 유사 결과가 **2건 미만**이면 `listRecentRepliesByType`(최근 3건)을 `PastReply`(`inquiryNo`·`title`·`excerpt` null)로 바꿔 뒤에 붙이고, 이미 유사 결과에 있는 답변 본문과 같으면 뺀다. 임베딩이 null(계산 실패)이면 유사 검색을 건너뛰고 최근 답변만 쓴다.

## 프롬프트 — `lib/suggest.ts`

`SuggestInput`을 바꾼다.

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
  pastReplies: PastReply[];
  /** serializeSources 결과. 자료가 없거나 서비스 문의면 "". */
  sourcesText: string;
}

export function buildSuggestPrompt(input: SuggestInput): { system: string; userMessage: string };
```

**system** (앞이 안정적일수록 프롬프트 캐시가 잘 맞는다. 규칙 → 자료 순):

1. 기존 규칙(한국어 본문만, 지어내지 않기, 템플릿 말투, 서명 금지)에 다음을 더한다.
   - "참고 자료에 있는 사실(이벤트 기간, 지급 기준, 운영 정책 등)로 답할 수 있으면 그 사실을 답변에 쓰세요. 자료에 없는 사실은 지어내지 말고 '확인 후 안내드리겠습니다'로 남기세요."
   - "과거 답변 예시는 표현 방식과 처리 방향을 참고하되, 그때의 계정·금액·날짜를 이번 답변에 옮겨 적지 마세요."
   - 출력 형식: "본문을 다 쓴 뒤 다음 줄에 `=== 근거 ===`를 쓰고, 그 아래에 참고한 자료를 한 줄에 하나씩 적으세요. 시트는 `VIP 시트 VIP 탭 7행`, 문서는 `운영 가이드 문서 '환불' 항목`, 과거 답변은 `과거 답변 R-20260902-0001`처럼. 참고한 것이 없으면 `없음`이라고 적으세요."
2. `sourcesText`가 비어 있지 않으면 `# 참고 자료` 아래에 그대로 붙인다.

**userMessage**: 지금처럼 게임·종류·유형·계정·회사·제목·본문 → `참고 템플릿` → `과거 문의와 답변` 구간. 과거 답변은 항목마다 `N) 문의 R-…: 제목` / `문의 요약: (excerpt)` / `보낸 답변:` / 본문. `inquiryNo`가 null인 대체 항목은 `N) 같은 유형의 최근 답변:` 뒤에 본문만.

### 근거 분리 — `lib/suggest-evidence.ts` (신규, 의존성 없음)

`SuggestButton`(클라이언트 컴포넌트)이 import하므로 `openai`를 import하는 `lib/suggest.ts`와 분리한다. `lib/suggest.ts`는 여기서 구분선 상수를 가져다 규칙 문구에 쓴다.

```ts
export const EVIDENCE_DELIMITER = "=== 근거 ===";
/** 스트리밍 중에도 매 조각마다 부른다. 끝에 걸친 구분선 조각("=== 근")은 본문에서 떼어 둔다. */
export function splitSuggestion(text: string): { body: string; evidence: string[] };
```

`evidence`는 구분선 아래 줄들에서 빈 줄·`없음`·머리글 기호(`- `, `• `, `1. `)를 정리한 것. 구분선이 없으면 `evidence`는 `[]`.

## 모델 호출 — `lib/suggest.ts`

```ts
export type SuggestErrorReason = "not_configured" | "refused" | "failed";
export type SuggestWarningReason = "sources_unavailable" | "similar_unavailable";
export type SuggestEvent =
  | { type: "text"; text: string }
  | { type: "warning"; reason: SuggestWarningReason; sourceTitle?: string }
  | { type: "error"; reason: SuggestErrorReason };

export async function* streamSuggestion(input: SuggestInput): AsyncGenerator<SuggestEvent>;
```

- `OPENAI_API_KEY` 없음 → `error not_configured`.
- `client.chat.completions.create({ model: process.env.OPENAI_MODEL ?? "gpt-5-mini", stream: true, reasoning_effort: "minimal", max_completion_tokens: 2048, messages: [system, user] })`. `temperature`는 넣지 않는다(gpt-5 계열은 기본값 외를 거절한다). 구현 때 SDK 타입으로 `reasoning_effort: "minimal"`이 허용되는지 확인하고, 아니면 `"low"`.
- `choices[0].finish_reason === "content_filter"` → `error refused`. 텍스트가 한 조각도 없이 끝나도 `refused`.
- 예외 → `console.warn` 후 `error failed`. 그 앞에 나간 텍스트는 유효하다(지금과 같음).
- `warning`은 `streamSuggestion`이 내지 않는다. 라우트가 앞에 붙인다.

## 라우트 — `app/api/inquiries/[id]/suggest/route.ts`

1. 세션·문의 확인(지금과 같음).
2. 병렬: 라벨, 게임 목록, 템플릿, `listSources`(게임 문의만), `ensureInquiryEmbedding`.
3. 자료: `sources`가 비어 있지 않으면 `loadSources` → `serializeSources`. `SheetError`(공유 안 됨·너무 큼·서비스 계정 미설정 포함)나 다른 예외면 `sourcesText = ""`로 두고 `warning sources_unavailable`(`sourceTitle`이 있으면 함께)을 기억한다. 자료가 등록돼 있지 않으면 경고 없이 빈 문자열.
4. 과거 답변: 임베딩이 있으면 `listSimilarAnsweredReplies`; null이면 `warning similar_unavailable`을 기억하고 건너뛴다. 2건 미만이면 최근 답변으로 보충(위 규칙).
5. 스트림: 기억한 `warning`들을 먼저 내고 `streamSuggestion`의 이벤트를 이어 낸다(한 async generator로 합친다). NDJSON 응답 형식은 그대로.

이벤트 순서를 warning → text로 고정하는 이유: 화면이 본문을 받기 전에 "자료 없이 작성 중"을 보여야 관리자가 결과를 그만큼만 믿는다.

## 화면 — `components/inquiries/SuggestButton.tsx`

- 스트림에서 받은 전체 텍스트를 `splitSuggestion`으로 나눠 **본문만** 미리보기와 "적용"에 쓴다. 근거는 미리보기 아래에 `참고한 자료` 소제목과 목록으로 회색(`text-muted`) 표시. 비어 있으면 그 영역을 그리지 않는다.
- `warning` 이벤트는 미리보기 위에 노란 안내줄로 남긴다(`role="status"`). 문구:
  - `sources_unavailable`: "운영 자료를 읽지 못해 자료 없이 작성했습니다." + `sourceTitle`이 있으면 " (자료: {제목})"
  - `similar_unavailable`: "유사 문의 검색이 안 돼 같은 유형의 최근 답변만 참고했습니다."
- 오류 문구의 `not_configured`는 "OPENAI_API_KEY가 설정되지 않았습니다."로.
- 생성 중 "적용" 비활성, 미리보기 후 적용/버리기 흐름은 그대로.

## 백필 — `scripts/backfill-inquiry-embeddings.js`

`scripts/get-gmail-refresh-token.js`처럼 의존성 없이 Node로 돈다. `.env.local`을 직접 읽어(`dotenv` 없이 줄 단위 파싱, 이미 설정된 환경변수가 우선) `SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`·`OPENAI_API_KEY`를 쓴다.

- 대상: `reply_content is not null and (embedding is null or embedding_model <> 'text-embedding-3-small')`. 50건씩 페이지(한 요청의 토큰 합계 상한 약 30만 아래로 머물기 위해).
- 페이지마다 `inquiryEmbeddingText`와 같은 규칙으로 입력을 만들어 embeddings API에 **한 번에 50개** 보내고, 행마다 `embedding`·`embedding_model`을 갱신한다. 페이지 전체가 실패해도 그 페이지의 id를 모두 실패로 기록하고 커서를 넘겨 계속한다.
- 진행 로그(처리/남은 건수)와 실패한 문의 id를 stderr에 낸다. 실패해도 계속 돌고, 다시 실행하면 남은 것만 한다.
- `lib/embeddings.ts`를 import하지 않는다(TS·경로 별칭 때문). 텍스트 규칙(제목+빈 줄+본문, 4000자)이 둘에 중복되므로 테스트에서 같은 상수를 쓰는지 확인한다.

## Gemini 제거

- `package.json`에서 `@google/genai` 삭제, `.env.example`에서 `GEMINI_API_KEY`·`GEMINI_MODEL` 삭제.
- `CLAUDE.md`: 핵심 기능에 "AI 답변 추천" 항목을 추가해 OpenAI·유사 답변·자료 근거·백필 절차를 적고, 어시스턴트 항목의 마이그레이션 번호를 고친다. 설정 절차 절에 "AI 답변 추천 설정 절차"(0021 실행, 백필 스크립트 실행)를 더한다.
- `docs/PRD.md`의 추천 라우트 설명을 갱신한다.

## 오류 처리 요약

| 상황 | 결과 |
|---|---|
| `OPENAI_API_KEY` 없음 | `error not_configured`. 추천 없음 |
| 자료 등록됐는데 읽기 실패·너무 큼·서비스 계정 없음 | 자료 없이 생성 + `warning sources_unavailable` |
| 임베딩 계산 실패(키 없음 포함) | 최근 답변으로 생성 + `warning similar_unavailable` |
| RPC 실패 | 유사 결과 `[]` → 최근 답변 보충. 경고 없음(로그만) |
| 유사 결과 없음(백필 전) | 최근 답변 보충. 경고 없음 |
| 안전 필터·빈 응답 | `error refused` |
| 발송 시 임베딩 실패 | 무시. 발송·기록은 영향 없음 |

## 테스트

- `tests/lib/embeddings.test.ts`: `inquiryEmbeddingText` 자르기, `ensureInquiryEmbedding` 저장된 벡터 재사용·모델 다르면 재계산·실패 시 null, openai 모킹.
- `tests/lib/suggest.test.ts`: 기존 프롬프트 테스트 갱신(자료 구간이 system 뒤에 오는지, 과거 답변 항목 형식, 대체 항목 형식, 근거 형식 규칙), `splitSuggestion`(구분선 없음·있음·끝에 걸친 조각·`없음`), `streamSuggestion`을 openai 모킹으로 교체(모델·`reasoning_effort`·`content_filter` → refused·예외 → failed).
- `tests/lib/replies.test.ts`: `listSimilarAnsweredReplies` RPC 인자·오류 시 `[]`.
- `tests/api/inquiry-suggest.test.ts`: 자료 로드 실패 → warning 후 text, 임베딩 null → similar_unavailable, 유사 2건 미만 → 최근 답변 보충·중복 제거, 서비스 문의 → 자료 조회 안 함.
- `tests/components/SuggestButton.test.tsx`: 근거가 본문과 분리돼 적용 텍스트에 안 들어감, warning 안내줄, 오류 문구.
- `tests/lib/send-reply.test.ts`: manual 발송 뒤 `ensureInquiryEmbedding` 호출, auto는 호출 안 함, 실패해도 결과 동일.
- 마이그레이션·백필 스크립트는 코드 리뷰와 실제 DB에서 한 번 실행으로 확인한다.
