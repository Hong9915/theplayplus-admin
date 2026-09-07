# AI 답변 추천 개편(OpenAI 전환 · 유사 답변 검색 · 운영 자료 근거) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "AI 답변 추천"을 Gemini에서 OpenAI로 옮기고, 임베딩으로 찾은 유사 과거 답변과 운영 어시스턴트에 연결된 시트·문서를 근거로 답변 초안을 만들며, 참고한 근거를 미리보기에 따로 보여준다.

**Architecture:** `lib/suggest.ts`가 프롬프트 조립(순수 함수)과 OpenAI 스트리밍을 맡고, 새 `lib/embeddings.ts`가 문의 임베딩을 만들어 `inquiries.embedding`에 저장한다. 라우트는 자료(`lib/assistant-sources.ts`의 로더 재사용)·유사 답변(`match_answered_inquiries` RPC)·템플릿을 모아 넘기고, 실패한 근거는 `warning` 이벤트로 먼저 흘려보낸 뒤 본문을 스트리밍한다. 근거 분리(`splitSuggestion`)는 의존성 없는 `lib/suggest-evidence.ts`에 둬 클라이언트 번들에 `openai`가 딸려 들어가지 않게 한다.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase(Postgres + pgvector), `openai` ^7.10 (chat.completions 스트리밍, embeddings), Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-07-openai-suggest-design.md`

## Global Constraints

- 작업 위치: 워크트리 `.claude/worktrees/openai-suggest`, 브랜치 `feat/openai-suggest`(`feat/sheet-assistant` 기반). 모든 명령은 그 디렉터리에서 실행한다.
- 관리자 UI 문구는 한국어. 코드 주석도 기존 파일의 한국어 스타일을 따른다.
- 채팅 모델: `process.env.OPENAI_MODEL ?? "gpt-5-mini"`, `reasoning_effort: "minimal"`, `max_completion_tokens: 2048`, `temperature`는 넣지 않는다.
- 임베딩: `text-embedding-3-small`, 1536차원, 입력 상한 8,000자.
- 유사 답변: 상위 5건, 유사도 0.35 이상. 2건 미만이면 같은 유형 최근 3건으로 보충.
- 자료: 게임 문의만, `listSources` → `loadSources` → `serializeSources` 그대로 재사용. 서비스 문의는 `sourcesText = ""`.
- 근거 구분선: `=== 근거 ===`. 화면은 구분선 앞만 적용한다.
- 마이그레이션 번호: 어시스턴트 0015→0017, 0016→0018, 0017→0019. 임베딩 0020.
- 테스트: `npx vitest run <파일>`로 개별 실행, 태스크 끝마다 커밋. 커밋 메시지 끝에 아래 두 줄을 붙인다.

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HzkFZximGaiVZjY3gauArg
```

---

## 파일 구조

| 파일 | 역할 |
|---|---|
| `supabase/migrations/0017_assistant.sql` 등 (이름 변경) | 어시스턴트 마이그레이션 번호 정리 |
| `supabase/migrations/0020_inquiry_embeddings.sql` (신규) | pgvector 확장, `inquiries.embedding`/`embedding_model`, HNSW 인덱스, `match_answered_inquiries` RPC |
| `lib/embeddings.ts` (신규) | 임베딩 텍스트 규칙, OpenAI embeddings 호출, 문의 임베딩 보장 |
| `lib/replies.ts` (수정) | `PastReply`, 유사 답변 RPC 조회, 최근 답변 보충 병합 |
| `lib/suggest-evidence.ts` (신규) | 구분선 상수, `splitSuggestion` (클라이언트에서도 import) |
| `lib/suggest.ts` (수정) | 프롬프트 조립(자료·유사 답변·근거 규칙), OpenAI 스트리밍, 이벤트 타입 |
| `app/api/inquiries/[id]/suggest/route.ts` (수정) | 자료·임베딩·유사 답변 수집, warning 선행 스트림 |
| `components/inquiries/SuggestButton.tsx` (수정) | 본문/근거 분리 표시, 경고 안내줄, 오류 문구 |
| `lib/send-reply.ts` (수정) | 수동 발송 뒤 임베딩 보장 |
| `scripts/backfill-inquiry-embeddings.js` (신규) | 기존 답변 완료 문의 임베딩 백필 |
| `.env.example`, `package.json`, `CLAUDE.md`, `docs/PRD.md` | Gemini 제거, 문서 |

---

### Task 1: 어시스턴트 마이그레이션 번호 정리

**Files:**
- Rename: `supabase/migrations/0015_assistant.sql` → `0017_assistant.sql`, `0016_assistant_attachments.sql` → `0018_assistant_attachments.sql`, `0017_assistant_sources.sql` → `0019_assistant_sources.sql`
- Modify: `CLAUDE.md`, `docs/PRD.md`, `docs/superpowers/specs/2026-09-04-sheet-assistant-design.md`, `docs/superpowers/specs/2026-09-07-assistant-sources-design.md`, `docs/superpowers/plans/2026-09-04-sheet-assistant.md`, `docs/superpowers/plans/2026-09-07-assistant-sources.md`, `app/api/assistant/messages/[id]/apply/route.ts:31`

**Interfaces:**
- Produces: 마이그레이션 파일 이름만 바뀐다. 코드 인터페이스 변화 없음.

- [ ] **Step 1: 파일 이름 변경**

```bash
git mv supabase/migrations/0017_assistant_sources.sql supabase/migrations/0019_assistant_sources.sql
git mv supabase/migrations/0016_assistant_attachments.sql supabase/migrations/0018_assistant_attachments.sql
git mv supabase/migrations/0015_assistant.sql supabase/migrations/0017_assistant.sql
ls supabase/migrations | tail -6
```

Expected: `0014_auto_reply_schedule.sql`, `0015_translations.sql`, `0017_assistant.sql`, `0018_assistant_attachments.sql`, `0019_assistant_sources.sql` (0016은 main 작업 트리에 미커밋으로만 있어 여기엔 없다).

- [ ] **Step 2: 문서·주석의 번호를 바꾼다**

한 표현식 안에서 0017→0019를 먼저, 0015→0017을 마지막에 바꿔 연쇄 치환을 막는다. 단어 경계(`\b`)로 `0015_translations` 같은 다른 번호는 건드리지 않는다(이 브랜치의 아래 파일들에는 번역 마이그레이션 언급이 없다).

```bash
perl -pi -e 's/\b0017\b/0019/g; s/\b0016\b/0018/g; s/\b0015\b/0017/g' \
  CLAUDE.md docs/PRD.md \
  docs/superpowers/specs/2026-09-04-sheet-assistant-design.md \
  docs/superpowers/specs/2026-09-07-assistant-sources-design.md \
  docs/superpowers/plans/2026-09-04-sheet-assistant.md \
  docs/superpowers/plans/2026-09-07-assistant-sources.md \
  "app/api/assistant/messages/[id]/apply/route.ts"
grep -rn '\b001[567]\b' CLAUDE.md docs/PRD.md docs/superpowers "app/api/assistant/messages/[id]/apply/route.ts" | grep -v "0015_translations\|openai-suggest"
```

Expected: 마지막 grep이 `0017`(옛 0015를 가리키는 어시스턴트 언급)만 보여주고, `0015`·`0016`은 어시스턴트 문맥에서 사라진다. `docs/superpowers/specs/2026-09-07-assistant-sources-design.md`의 "0017 — 0016은 첨부 파일용으로 이미 쓰였다"가 "0019 — 0018은 …"으로 바뀌었는지 눈으로 확인한다.

- [ ] **Step 3: 테스트가 여전히 통과하는지 확인**

Run: `npx vitest run`
Expected: 78 files, 679 tests passed (마이그레이션 파일은 코드가 참조하지 않는다).

- [ ] **Step 4: 커밋**

```bash
git add -A supabase/migrations CLAUDE.md docs "app/api/assistant/messages/[id]/apply/route.ts"
git commit -m "chore: 어시스턴트 마이그레이션을 0017~0019로 옮겨 main의 0015·0016과 충돌 방지"
```

---

### Task 2: 마이그레이션 0020 — pgvector 컬럼과 유사 문의 RPC

**Files:**
- Create: `supabase/migrations/0020_inquiry_embeddings.sql`
- Modify: `docs/PRD.md` (테이블 표 아래 `inquiries` 주요 컬럼 절, 마이그레이션 목록이 있으면 거기)

**Interfaces:**
- Produces: `inquiries.embedding vector(1536)`, `inquiries.embedding_model text`, RPC `match_answered_inquiries(p_game_id uuid, p_query vector, p_exclude_id uuid, p_limit int, p_min_similarity float)` → `(id, inquiry_no, title, content, reply_body, similarity)`. Task 4의 `listSimilarAnsweredReplies`가 부른다.

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- AI 답변 추천의 유사 문의 검색.
--
-- 문의 제목+본문을 OpenAI text-embedding-3-small(1536차원)로 임베딩해 저장하고,
-- 새 문의와 코사인 거리가 가까운 "답변이 있는" 과거 문의를 같은 스코프(게임 하나
-- 또는 서비스 문의) 안에서 찾는다. 답변 본문은 첫 수동 답변이다 — 자동 발송
-- 매크로(auto_sent)는 근거가 못 되고, 뒤의 답변은 회신에 대한 것이라서다.
--
-- embedding_model은 어떤 모델로 만든 벡터인지 기록한다. 모델을 바꾸면 값이
-- 달라 코드가 그 문의만 다시 계산한다.
--
-- anon(접수 폼)은 열 단위 select 권한만 있어 새 열은 노출되지 않는다.

create extension if not exists vector with schema extensions;

alter table inquiries add column if not exists embedding extensions.vector(1536);
alter table inquiries add column if not exists embedding_model text;

create index if not exists inquiries_embedding_idx
  on inquiries using hnsw (embedding extensions.vector_cosine_ops);

create or replace function match_answered_inquiries(
  p_game_id uuid,
  p_query extensions.vector(1536),
  p_exclude_id uuid,
  p_limit int default 5,
  p_min_similarity float default 0.35
) returns table (
  id uuid,
  inquiry_no text,
  title text,
  content text,
  reply_body text,
  similarity float
)
language sql
stable
as $$
  select ranked.id, ranked.inquiry_no, ranked.title, ranked.content, ranked.reply_body, ranked.similarity
  from (
    select
      i.id,
      i.inquiry_no,
      i.title,
      i.content,
      coalesce(
        (
          select m.body
          from inquiry_messages m
          where m.inquiry_id = i.id
            and m.direction = 'outbound'
            and m.auto_sent = false
          order by m.sent_at
          limit 1
        ),
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
  where ranked.similarity >= p_min_similarity
  order by ranked.similarity desc;
$$;
```

- [ ] **Step 2: PRD의 `inquiries` 주요 컬럼 절에 두 열을 추가**

`docs/PRD.md`에서 `### \`inquiries\` 주요 컬럼` 절을 찾아(Task 1 이후 줄 번호가 달라질 수 있으니 grep) 그 표 끝에 다음 두 행을 붙인다. 표 형식은 그 절의 기존 행을 따른다.

```markdown
| `embedding` | 제목+본문 임베딩(`vector(1536)`, text-embedding-3-small). AI 답변 추천의 유사 문의 검색용 | 0020 |
| `embedding_model` | `embedding`을 만든 모델명. 다르면 다시 계산 | 0020 |
```

- [ ] **Step 3: SQL 문법 확인**

로컬 Postgres가 없으므로 눈으로 확인한다: `$$` 짝, `returns table` 열 이름이 바깥 select와 같음, `<=>` 연산자(코사인 거리) 사용, `extensions.vector_cosine_ops` 표기.

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/0020_inquiry_embeddings.sql docs/PRD.md
git commit -m "feat: 문의 임베딩 컬럼과 유사 문의 RPC (마이그레이션 0020)"
```

---

### Task 3: `lib/embeddings.ts` — 임베딩 계산과 저장

**Files:**
- Create: `lib/embeddings.ts`
- Test: `tests/lib/embeddings.test.ts`

**Interfaces:**
- Produces:
  - `EMBEDDING_MODEL = "text-embedding-3-small"`, `EMBEDDING_DIMENSIONS = 1536`, `EMBEDDING_MAX_CHARS = 8000`
  - `inquiryEmbeddingText(inquiry: { title: string; content: string }): string`
  - `embedText(text: string): Promise<number[]>` — `EmbeddingError("not_configured" | "failed")`를 던진다
  - `ensureInquiryEmbedding(supabase: SupabaseClient, inquiry: { id: string; title: string; content: string }): Promise<number[] | null>` — 절대 던지지 않는다
  - `class EmbeddingError extends Error { reason: EmbeddingErrorReason }`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/lib/embeddings.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  EMBEDDING_MAX_CHARS,
  EMBEDDING_MODEL,
  EmbeddingError,
  embedText,
  ensureInquiryEmbedding,
  inquiryEmbeddingText,
} from "@/lib/embeddings";

const createMock = vi.fn();
vi.mock("openai", () => ({
  default: vi.fn(function () {
    return { embeddings: { create: createMock } };
  }),
}));

const VECTOR = Array.from({ length: 1536 }, (_, i) => i / 1536);

function mockSupabase(stored: { embedding: unknown; embedding_model: string | null } | null, updateError: { message: string } | null = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: stored, error: null });
  const eqSelect = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq: eqSelect }));
  const eqUpdate = vi.fn().mockResolvedValue({ error: updateError });
  const update = vi.fn(() => ({ eq: eqUpdate }));
  const from = vi.fn(() => ({ select, update }));
  return { supabase: { from } as never, from, select, update, eqUpdate };
}

describe("inquiryEmbeddingText", () => {
  it("joins the title and body with a blank line", () => {
    expect(inquiryEmbeddingText({ title: " 결제 오류 ", content: "다이아가 안 들어와요\n" })).toBe("결제 오류\n\n다이아가 안 들어와요");
  });

  it("cuts the text at the character limit", () => {
    const text = inquiryEmbeddingText({ title: "제목", content: "가".repeat(EMBEDDING_MAX_CHARS) });
    expect(text.length).toBe(EMBEDDING_MAX_CHARS);
  });
});

describe("embedText", () => {
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    createMock.mockReset();
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  it("throws not_configured without calling the SDK when the key is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(embedText("본문")).rejects.toMatchObject({ reason: "not_configured" });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("calls the embeddings API with the model and dimensions and returns the vector", async () => {
    createMock.mockResolvedValue({ data: [{ embedding: VECTOR }] });

    await expect(embedText("본문")).resolves.toEqual(VECTOR);
    expect(createMock).toHaveBeenCalledWith({ model: EMBEDDING_MODEL, input: "본문", dimensions: 1536 });
  });

  it("throws failed when the SDK throws", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createMock.mockRejectedValue(new Error("network down"));

    await expect(embedText("본문")).rejects.toBeInstanceOf(EmbeddingError);
    await expect(embedText("본문")).rejects.toMatchObject({ reason: "failed" });
    warnSpy.mockRestore();
  });

  it("throws failed when the response has the wrong shape", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createMock.mockResolvedValue({ data: [{ embedding: [1, 2, 3] }] });

    await expect(embedText("본문")).rejects.toMatchObject({ reason: "failed" });
    warnSpy.mockRestore();
  });
});

describe("ensureInquiryEmbedding", () => {
  const inquiry = { id: "inq-1", title: "결제 오류", content: "다이아가 안 들어와요" };
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    createMock.mockReset().mockResolvedValue({ data: [{ embedding: VECTOR }] });
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  it("reuses a stored vector made by the same model (supabase returns it as a string)", async () => {
    const { supabase, update } = mockSupabase({ embedding: JSON.stringify(VECTOR), embedding_model: EMBEDDING_MODEL });

    await expect(ensureInquiryEmbedding(supabase, inquiry)).resolves.toEqual(VECTOR);
    expect(createMock).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("computes and stores the vector when none is saved", async () => {
    const { supabase, from, update, eqUpdate } = mockSupabase({ embedding: null, embedding_model: null });

    await expect(ensureInquiryEmbedding(supabase, inquiry)).resolves.toEqual(VECTOR);
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ input: "결제 오류\n\n다이아가 안 들어와요" }));
    expect(from).toHaveBeenCalledWith("inquiries");
    expect(update).toHaveBeenCalledWith({ embedding: VECTOR, embedding_model: EMBEDDING_MODEL });
    expect(eqUpdate).toHaveBeenCalledWith("id", "inq-1");
  });

  it("recomputes when the stored vector came from another model", async () => {
    const { supabase, update } = mockSupabase({ embedding: JSON.stringify(VECTOR), embedding_model: "text-embedding-ada-002" });

    await ensureInquiryEmbedding(supabase, inquiry);
    expect(createMock).toHaveBeenCalled();
    expect(update).toHaveBeenCalled();
  });

  it("still returns the vector when saving it fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { supabase } = mockSupabase({ embedding: null, embedding_model: null }, { message: "db down" });

    await expect(ensureInquiryEmbedding(supabase, inquiry)).resolves.toEqual(VECTOR);
    warnSpy.mockRestore();
  });

  it("returns null instead of throwing when embedding fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createMock.mockRejectedValue(new Error("boom"));
    const { supabase } = mockSupabase({ embedding: null, embedding_model: null });

    await expect(ensureInquiryEmbedding(supabase, inquiry)).resolves.toBeNull();
    warnSpy.mockRestore();
  });

  it("returns null quietly when the key is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    const { supabase } = mockSupabase({ embedding: null, embedding_model: null });

    await expect(ensureInquiryEmbedding(supabase, inquiry)).resolves.toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/lib/embeddings.test.ts`
Expected: FAIL — `Cannot find module '@/lib/embeddings'`

- [ ] **Step 3: 구현**

```ts
// lib/embeddings.ts
import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 문의 임베딩. AI 답변 추천이 "내용이 비슷한 과거 문의"를 찾는 근거다.
 *
 * 벡터는 inquiries.embedding에 저장하고, 어느 모델로 만들었는지
 * embedding_model에 남긴다. 모델을 바꾸면 값이 달라 그 문의만 다시 계산한다.
 */

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
/** 임베딩 입력 상한(글자). 모델 상한 8191토큰 아래에 넉넉히 둔다. 백필 스크립트도 같은 값을 쓴다. */
export const EMBEDDING_MAX_CHARS = 8000;

export type EmbeddingErrorReason = "not_configured" | "failed";

export class EmbeddingError extends Error {
  constructor(public readonly reason: EmbeddingErrorReason) {
    super(reason);
    this.name = "EmbeddingError";
  }
}

/** 제목 + 빈 줄 + 본문. 상한을 넘으면 뒤를 자른다. */
export function inquiryEmbeddingText(inquiry: { title: string; content: string }): string {
  const text = `${inquiry.title.trim()}\n\n${inquiry.content.trim()}`;
  return text.length > EMBEDDING_MAX_CHARS ? text.slice(0, EMBEDDING_MAX_CHARS) : text;
}

export async function embedText(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new EmbeddingError("not_configured");

  try {
    const client = new OpenAI({ apiKey });
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
      dimensions: EMBEDDING_DIMENSIONS,
    });
    const vector = response.data[0]?.embedding;
    if (!vector || vector.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(`unexpected embedding shape: ${vector?.length ?? "none"}`);
    }
    return vector;
  } catch (error) {
    console.warn("[embeddings] OpenAI request failed", error);
    throw new EmbeddingError("failed");
  }
}

/** supabase-js는 vector 열을 "[0.1,0.2,…]" 문자열로 돌려준다. 배열이면 그대로. */
function parseStoredEmbedding(value: unknown): number[] | null {
  if (Array.isArray(value)) {
    return value.every((entry) => typeof entry === "number") ? (value as number[]) : null;
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as number[]) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 문의의 임베딩을 돌려준다. 저장된 것이 있고 모델이 같으면 그대로, 아니면 계산해
 * 저장한다. 어떤 실패도 null로 돌려준다 — 호출부(추천·발송)가 막히면 안 된다.
 */
export async function ensureInquiryEmbedding(
  supabase: SupabaseClient,
  inquiry: { id: string; title: string; content: string }
): Promise<number[] | null> {
  try {
    const { data } = await supabase
      .from("inquiries")
      .select("embedding, embedding_model")
      .eq("id", inquiry.id)
      .maybeSingle();

    if (data?.embedding_model === EMBEDDING_MODEL) {
      const stored = parseStoredEmbedding(data.embedding);
      if (stored) return stored;
    }

    const vector = await embedText(inquiryEmbeddingText(inquiry));

    const { error } = await supabase
      .from("inquiries")
      .update({ embedding: vector, embedding_model: EMBEDDING_MODEL })
      .eq("id", inquiry.id);
    if (error) {
      // 저장이 실패해도 이번 검색에는 쓸 수 있다.
      console.warn("[embeddings] failed to store inquiry embedding", error);
    }
    return vector;
  } catch (error) {
    // 키가 없는 건 설정 문제라 매번 경고할 필요가 없다.
    if (!(error instanceof EmbeddingError && error.reason === "not_configured")) {
      console.warn("[embeddings] ensureInquiryEmbedding failed", error);
    }
    return null;
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/lib/embeddings.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/embeddings.ts tests/lib/embeddings.test.ts
git commit -m "feat: 문의 임베딩 계산·저장 모듈"
```

---

### Task 4: `lib/replies.ts` — 유사 답변 조회와 최근 답변 보충

**Files:**
- Modify: `lib/replies.ts`
- Test: `tests/lib/replies.test.ts`

**Interfaces:**
- Consumes: RPC `match_answered_inquiries` (Task 2)
- Produces:
  - `interface PastReply { inquiryNo: string | null; title: string | null; excerpt: string | null; reply: string }`
  - `PAST_REPLY_EXCERPT_CHARS = 500`
  - `listSimilarAnsweredReplies(supabase, scope: InboxScope, embedding: number[], excludeId: string, limit = 5): Promise<PastReply[]>`
  - `mergePastReplies(similar: PastReply[], recent: string[]): PastReply[]`
  - 기존 `listRecentRepliesByType`은 그대로 (`string[]`)

- [ ] **Step 1: 실패하는 테스트 추가**

`tests/lib/replies.test.ts` 맨 위 import를 바꾸고 파일 끝에 두 describe를 붙인다.

```ts
import { describe, it, expect, vi } from "vitest";
import { listRecentRepliesByType, listSimilarAnsweredReplies, mergePastReplies, type PastReply } from "@/lib/replies";
import { SERVICE_SCOPE, gameScope } from "@/lib/inbox-scope";
```

```ts
describe("listSimilarAnsweredReplies", () => {
  const embedding = [0.1, 0.2, 0.3];

  function rpcClient(data: unknown, error: { message: string } | null = null) {
    const rpc = vi.fn().mockResolvedValue({ data, error });
    return { client: { rpc } as never, rpc };
  }

  it("calls the RPC with the game id, vector, excluded inquiry, and limit", async () => {
    const { client, rpc } = rpcClient([
      { id: "old-1", inquiry_no: "R-1", title: "결제 안 됨", content: "카드 결제가 두 번 됐어요", reply_body: "환불 처리했습니다", similarity: 0.8 },
    ]);

    const result = await listSimilarAnsweredReplies(client, gameScope("game-1"), embedding, "inq-1");

    expect(rpc).toHaveBeenCalledWith("match_answered_inquiries", {
      p_game_id: "game-1",
      p_query: embedding,
      p_exclude_id: "inq-1",
      p_limit: 5,
    });
    expect(result).toEqual<PastReply[]>([
      { inquiryNo: "R-1", title: "결제 안 됨", excerpt: "카드 결제가 두 번 됐어요", reply: "환불 처리했습니다" },
    ]);
  });

  it("passes null for the service scope and honours the limit", async () => {
    const { client, rpc } = rpcClient([]);

    await listSimilarAnsweredReplies(client, SERVICE_SCOPE, embedding, "inq-1", 3);

    expect(rpc).toHaveBeenCalledWith("match_answered_inquiries", expect.objectContaining({ p_game_id: null, p_limit: 3 }));
  });

  it("cuts the excerpt at 500 characters and drops rows without a reply body", async () => {
    const { client } = rpcClient([
      { id: "a", inquiry_no: "R-1", title: "긴 문의", content: "가".repeat(700), reply_body: "답변", similarity: 0.9 },
      { id: "b", inquiry_no: "R-2", title: "빈 답변", content: "본문", reply_body: "   ", similarity: 0.7 },
      { id: "c", inquiry_no: null, title: "null 답변", content: "본문", reply_body: null, similarity: 0.6 },
    ]);

    const result = await listSimilarAnsweredReplies(client, gameScope("game-1"), embedding, "inq-1");

    expect(result).toHaveLength(1);
    expect(result[0].excerpt).toHaveLength(500);
  });

  it("returns an empty array when the RPC errors", async () => {
    const { client } = rpcClient(null, { message: "function does not exist" });
    await expect(listSimilarAnsweredReplies(client, gameScope("game-1"), embedding, "inq-1")).resolves.toEqual([]);
  });
});

describe("mergePastReplies", () => {
  const similar = (reply: string): PastReply => ({ inquiryNo: "R-1", title: "제목", excerpt: "요약", reply });

  it("keeps similar replies alone when there are at least two", () => {
    const result = mergePastReplies([similar("A"), similar("B")], ["C"]);
    expect(result.map((entry) => entry.reply)).toEqual(["A", "B"]);
  });

  it("appends recent replies as fallback entries when fewer than two similar ones exist", () => {
    const result = mergePastReplies([similar("A")], ["C", "D"]);
    expect(result).toEqual([
      similar("A"),
      { inquiryNo: null, title: null, excerpt: null, reply: "C" },
      { inquiryNo: null, title: null, excerpt: null, reply: "D" },
    ]);
  });

  it("skips recent replies whose body already appears among the similar ones", () => {
    const result = mergePastReplies([similar("A")], ["A", "B"]);
    expect(result.map((entry) => entry.reply)).toEqual(["A", "B"]);
  });

  it("uses only recent replies when nothing similar was found", () => {
    expect(mergePastReplies([], ["X"])).toEqual([{ inquiryNo: null, title: null, excerpt: null, reply: "X" }]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/lib/replies.test.ts`
Expected: FAIL — `listSimilarAnsweredReplies is not a function` (또는 export 없음)

- [ ] **Step 3: 구현** — `lib/replies.ts`에 추가 (기존 함수는 그대로 둔다)

```ts
/** 추천 프롬프트에 넣는 과거 답변 한 건. 유사도 검색으로 찾은 것은 문의 요약이 함께 온다. */
export interface PastReply {
  /** 유사도 검색으로 찾은 경우에만 채워진다. 최근 답변 대체 경로에서는 null. */
  inquiryNo: string | null;
  title: string | null;
  /** 과거 문의 본문 앞부분. 모델이 "어떤 문의에 이렇게 답했는지" 보게 한다. */
  excerpt: string | null;
  reply: string;
}

export const PAST_REPLY_EXCERPT_CHARS = 500;

interface MatchRow {
  id: string;
  inquiry_no: string | null;
  title: string | null;
  content: string | null;
  reply_body: string | null;
  similarity: number;
}

/**
 * 같은 스코프에서 내용이 비슷한, 답변이 있는 과거 문의(마이그레이션 0020의 RPC).
 * 임베딩이 없는 문의는 RPC가 걸러낸다. 오류·빈 결과는 []로 돌려 호출부가
 * 최근 답변으로 보충하게 한다.
 */
export async function listSimilarAnsweredReplies(
  supabase: SupabaseClient,
  scope: InboxScope,
  embedding: number[],
  excludeId: string,
  limit = 5
): Promise<PastReply[]> {
  const { data, error } = await supabase.rpc("match_answered_inquiries", {
    p_game_id: scopeGameId(scope),
    p_query: embedding,
    p_exclude_id: excludeId,
    p_limit: limit,
  });

  if (error || !data) {
    if (error) console.warn("[replies] match_answered_inquiries failed", error);
    return [];
  }

  return (data as MatchRow[])
    .filter((row) => typeof row.reply_body === "string" && row.reply_body.trim() !== "")
    .map((row) => ({
      inquiryNo: row.inquiry_no ?? null,
      title: row.title ?? null,
      excerpt: row.content ? row.content.slice(0, PAST_REPLY_EXCERPT_CHARS) : null,
      reply: row.reply_body as string,
    }));
}

/**
 * 유사 답변이 2건 미만이면 같은 유형의 최근 답변으로 보충한다. 백필 전이거나
 * 그 게임에 답변이 적을 때도 근거가 비지 않게 하려는 것이다.
 */
export function mergePastReplies(similar: PastReply[], recent: string[]): PastReply[] {
  if (similar.length >= 2) return similar;
  const seen = new Set(similar.map((entry) => entry.reply));
  const fallback = recent
    .filter((reply) => !seen.has(reply))
    .map((reply) => ({ inquiryNo: null, title: null, excerpt: null, reply }));
  return [...similar, ...fallback];
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/lib/replies.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/replies.ts tests/lib/replies.test.ts
git commit -m "feat: 유사 과거 답변 RPC 조회와 최근 답변 보충"
```

---

### Task 5: 근거 분리 — `lib/suggest-evidence.ts`

**Files:**
- Create: `lib/suggest-evidence.ts`
- Test: `tests/lib/suggest-evidence.test.ts`

**Interfaces:**
- Produces: `EVIDENCE_DELIMITER = "=== 근거 ==="`, `splitSuggestion(text: string): { body: string; evidence: string[] }`. Task 6의 프롬프트 규칙과 Task 8의 화면이 쓴다. 이 파일은 의존성이 없어야 한다(클라이언트 컴포넌트가 import).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/lib/suggest-evidence.test.ts
import { describe, it, expect } from "vitest";
import { EVIDENCE_DELIMITER, splitSuggestion } from "@/lib/suggest-evidence";

describe("splitSuggestion", () => {
  it("returns the whole text as body when there is no delimiter", () => {
    expect(splitSuggestion("안녕하세요.\n확인 후 안내드리겠습니다.")).toEqual({
      body: "안녕하세요.\n확인 후 안내드리겠습니다.",
      evidence: [],
    });
  });

  it("splits the body from the evidence lines and strips list markers", () => {
    const text = `안녕하세요.\n${EVIDENCE_DELIMITER}\n- VIP 시트 VIP 탭 7행\n1. 과거 답변 R-20260902-0001\n\n• 운영 가이드 문서 '환불' 항목\n`;
    expect(splitSuggestion(text)).toEqual({
      body: "안녕하세요.\n",
      evidence: ["VIP 시트 VIP 탭 7행", "과거 답변 R-20260902-0001", "운영 가이드 문서 '환불' 항목"],
    });
  });

  it("treats '없음' as no evidence", () => {
    expect(splitSuggestion(`본문\n${EVIDENCE_DELIMITER}\n없음`)).toEqual({ body: "본문\n", evidence: [] });
  });

  it("holds back a partial delimiter at the end of a streaming chunk", () => {
    expect(splitSuggestion("본문\n=== 근")).toEqual({ body: "본문\n", evidence: [] });
    expect(splitSuggestion("본문\n=")).toEqual({ body: "본문\n", evidence: [] });
  });

  it("does not treat an equals sign inside the body as a delimiter", () => {
    expect(splitSuggestion("a = b 입니다.")).toEqual({ body: "a = b 입니다.", evidence: [] });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/lib/suggest-evidence.test.ts`
Expected: FAIL — `Cannot find module '@/lib/suggest-evidence'`

- [ ] **Step 3: 구현**

```ts
// lib/suggest-evidence.ts
/**
 * 추천 답변의 본문과 근거를 나눈다.
 *
 * 모델은 본문 뒤에 구분선을 쓰고 참고한 자료를 한 줄에 하나씩 적는다. 화면은
 * 본문만 답변에 적용하고 근거는 따로 보여준다. 이 파일은 클라이언트 컴포넌트가
 * import하므로 서버 전용 의존성(openai 등)을 두지 않는다.
 */

export const EVIDENCE_DELIMITER = "=== 근거 ===";

const LIST_MARKER = /^\s*(?:[-•*]|\d+[.)])\s*/;

/** 스트리밍 중에도 매 조각마다 부른다. 끝에 걸친 구분선 조각("=== 근")은 본문에서 떼어 둔다. */
export function splitSuggestion(text: string): { body: string; evidence: string[] } {
  const index = text.indexOf(EVIDENCE_DELIMITER);
  if (index === -1) {
    return { body: trimPartialDelimiter(text), evidence: [] };
  }

  const body = text.slice(0, index);
  const evidence = text
    .slice(index + EVIDENCE_DELIMITER.length)
    .split("\n")
    .map((line) => line.replace(LIST_MARKER, "").trim())
    .filter((line) => line !== "" && line !== "없음");

  return { body, evidence };
}

function trimPartialDelimiter(text: string): string {
  for (let length = EVIDENCE_DELIMITER.length - 1; length > 0; length -= 1) {
    if (text.endsWith(EVIDENCE_DELIMITER.slice(0, length))) {
      return text.slice(0, text.length - length);
    }
  }
  return text;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/lib/suggest-evidence.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/suggest-evidence.ts tests/lib/suggest-evidence.test.ts
git commit -m "feat: 추천 답변 본문과 근거 분리"
```

---

### Task 6: `lib/suggest.ts` — 프롬프트 개편과 OpenAI 스트리밍, Gemini 제거

**Files:**
- Modify: `lib/suggest.ts` (전체 교체)
- Modify: `package.json`, `package-lock.json` (`@google/genai` 제거), `.env.example`
- Test: `tests/lib/suggest.test.ts` (전체 교체)

**Interfaces:**
- Consumes: `PastReply` (Task 4), `EVIDENCE_DELIMITER` (Task 5)
- Produces:
  - `interface SuggestInput { gameName; groupLabel; typeLabel; title; content; gameAccount; companyName; templates: Array<{title; content}>; pastReplies: PastReply[]; sourcesText: string }`
  - `type SuggestErrorReason = "not_configured" | "refused" | "failed"`
  - `type SuggestWarningReason = "sources_unavailable" | "similar_unavailable"`
  - `type SuggestEvent = { type: "text"; text } | { type: "warning"; reason: SuggestWarningReason; sourceTitle?: string } | { type: "error"; reason: SuggestErrorReason }`
  - `buildSuggestPrompt(input): { system: string; userMessage: string }`
  - `streamSuggestion(input): AsyncGenerator<SuggestEvent>` — `warning`은 내지 않는다(라우트가 앞에 붙인다)

- [ ] **Step 1: 테스트 파일 교체**

```ts
// tests/lib/suggest.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildSuggestPrompt, streamSuggestion, type SuggestEvent, type SuggestInput } from "@/lib/suggest";
import { EVIDENCE_DELIMITER } from "@/lib/suggest-evidence";

const createMock = vi.fn();
vi.mock("openai", () => ({
  default: vi.fn(function () {
    return { chat: { completions: { create: createMock } } };
  }),
}));

function makeInput(overrides: Partial<SuggestInput> = {}): SuggestInput {
  return {
    gameName: "여신키우기",
    groupLabel: "게임 이용 문의",
    typeLabel: "결제/환불",
    title: "결제했는데 재화가 안 들어와요",
    content: "어제 30000원 결제했는데 다이아가 지급되지 않았습니다.",
    gameAccount: "player#1234",
    companyName: null,
    templates: [],
    pastReplies: [],
    sourcesText: "",
    ...overrides,
  };
}

describe("buildSuggestPrompt", () => {
  it("states the core rules in the system prompt", () => {
    const { system } = buildSuggestPrompt(makeInput());
    expect(system).toContain("한국어");
    expect(system).toContain("지어내지");
    expect(system).toContain("확인 후 안내드리겠습니다");
    expect(system).toContain("서명");
    // 템플릿 제목을 본문에 복사하는 실제 사례가 있었다.
    expect(system).toContain("제목");
  });

  it("tells the model to use facts from the sources and to end with an evidence section", () => {
    const { system } = buildSuggestPrompt(makeInput());
    expect(system).toContain("참고 자료에 있는 사실");
    expect(system).toContain(EVIDENCE_DELIMITER);
    expect(system).toContain("없음");
    // 과거 답변의 계정·금액·날짜를 옮겨 적으면 안 된다.
    expect(system).toContain("옮겨 적지");
  });

  it("appends the sources after the rules so the stable prefix caches", () => {
    const { system } = buildSuggestPrompt(makeInput({ sourcesText: "# 시트: VIP 원장\n\n## VIP\n이메일 | VIP 단계" }));
    const rulesEnd = system.indexOf("# 참고 자료");
    expect(rulesEnd).toBeGreaterThan(0);
    expect(system.slice(rulesEnd)).toContain("VIP 원장");
    expect(system.indexOf("지어내지")).toBeLessThan(rulesEnd);
  });

  it("omits the sources section when there are none", () => {
    expect(buildSuggestPrompt(makeInput()).system).not.toContain("# 참고 자료");
  });

  it("includes the game, category, title, and body", () => {
    const { userMessage } = buildSuggestPrompt(makeInput());
    expect(userMessage).toContain("여신키우기");
    expect(userMessage).toContain("게임 이용 문의");
    expect(userMessage).toContain("결제/환불");
    expect(userMessage).toContain("결제했는데 재화가 안 들어와요");
    expect(userMessage).toContain("다이아가 지급되지 않았습니다");
  });

  it("includes the game account when present and omits the line when not", () => {
    expect(buildSuggestPrompt(makeInput()).userMessage).toContain("player#1234");
    const withoutAccount = buildSuggestPrompt(makeInput({ gameAccount: null })).userMessage;
    expect(withoutAccount).not.toContain("게임 계정");
  });

  it("includes the company name only when present", () => {
    const withCompany = buildSuggestPrompt(makeInput({ companyName: "플레이컴퍼니" })).userMessage;
    expect(withCompany).toContain("플레이컴퍼니");
    expect(buildSuggestPrompt(makeInput()).userMessage).not.toContain("회사명");
  });

  it("includes templates when given", () => {
    const { userMessage } = buildSuggestPrompt(
      makeInput({ templates: [{ title: "환불 안내", content: "환불 절차는 다음과 같습니다." }] })
    );
    expect(userMessage).toContain("참고 템플릿");
    expect(userMessage).toContain("환불 안내");
    expect(userMessage).toContain("환불 절차는 다음과 같습니다.");
    // 제목을 대괄호로 감싸면 모델이 본문 머리말로 오해해 그대로 복사한다.
    expect(userMessage).not.toContain("[환불 안내]");
  });

  it("omits the template section entirely when there are none", () => {
    expect(buildSuggestPrompt(makeInput()).userMessage).not.toContain("참고 템플릿");
  });

  it("lists similar past inquiries with their number, summary, and reply", () => {
    const { userMessage } = buildSuggestPrompt(
      makeInput({
        pastReplies: [
          { inquiryNo: "R-20260902-0001", title: "결제 두 번 됨", excerpt: "카드가 두 번 긁혔어요", reply: "중복 결제분은 환불했습니다." },
        ],
      })
    );
    expect(userMessage).toContain("과거 문의와 답변");
    expect(userMessage).toContain("1) 문의 R-20260902-0001: 결제 두 번 됨");
    expect(userMessage).toContain("문의 요약: 카드가 두 번 긁혔어요");
    expect(userMessage).toContain("보낸 답변:");
    expect(userMessage).toContain("중복 결제분은 환불했습니다.");
  });

  it("labels fallback entries as recent replies of the same type without a summary", () => {
    const { userMessage } = buildSuggestPrompt(
      makeInput({ pastReplies: [{ inquiryNo: null, title: null, excerpt: null, reply: "확인 후 지급해드렸습니다." }] })
    );
    expect(userMessage).toContain("1) 같은 유형의 최근 답변:");
    expect(userMessage).toContain("확인 후 지급해드렸습니다.");
    expect(userMessage).not.toContain("문의 요약");
  });

  it("omits the past-reply section entirely when there are none", () => {
    expect(buildSuggestPrompt(makeInput()).userMessage).not.toContain("과거 문의와 답변");
  });
});

/** OpenAI 스트림 chunk를 흉내 낸다. */
function chunks(items: Array<{ text?: string; finishReason?: string | null }>) {
  return (async function* () {
    for (const item of items) {
      yield { choices: [{ delta: { content: item.text }, finish_reason: item.finishReason ?? null }] };
    }
  })();
}

async function collect(input: SuggestInput): Promise<SuggestEvent[]> {
  const events: SuggestEvent[] = [];
  for await (const event of streamSuggestion(input)) events.push(event);
  return events;
}

describe("streamSuggestion", () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_MODEL;

  beforeEach(() => {
    createMock.mockReset();
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.OPENAI_MODEL;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = originalModel;
  });

  it("reports not_configured without calling the SDK when the key is missing", async () => {
    delete process.env.OPENAI_API_KEY;

    await expect(collect(makeInput())).resolves.toEqual([{ type: "error", reason: "not_configured" }]);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("yields each text chunk as it arrives", async () => {
    createMock.mockResolvedValue(chunks([{ text: "안녕하세요, " }, { text: "확인 후 " }, { text: "안내드리겠습니다." }]));

    await expect(collect(makeInput())).resolves.toEqual([
      { type: "text", text: "안녕하세요, " },
      { type: "text", text: "확인 후 " },
      { type: "text", text: "안내드리겠습니다." },
    ]);
  });

  it("skips chunks that carry no text", async () => {
    createMock.mockResolvedValue(chunks([{ text: "" }, { text: undefined }, { text: "본문" }]));

    await expect(collect(makeInput())).resolves.toEqual([{ type: "text", text: "본문" }]);
  });

  it("defaults to gpt-5-mini and honours OPENAI_MODEL", async () => {
    createMock.mockImplementation(async () => chunks([{ text: "본문" }]));

    await collect(makeInput());
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5-mini" }));

    process.env.OPENAI_MODEL = "gpt-5-something";
    await collect(makeInput());
    expect(createMock).toHaveBeenLastCalledWith(expect.objectContaining({ model: "gpt-5-something" }));
  });

  it("streams with minimal reasoning, no temperature, and the system prompt first", async () => {
    createMock.mockResolvedValue(chunks([{ text: "본문" }]));

    await collect(makeInput());

    const call = createMock.mock.calls[0][0];
    expect(call.stream).toBe(true);
    expect(call.reasoning_effort).toBe("minimal");
    expect(call.max_completion_tokens).toBe(2048);
    // gpt-5 계열은 기본값 외의 temperature를 거절한다.
    expect(call).not.toHaveProperty("temperature");
    expect(call.messages[0]).toEqual({ role: "system", content: expect.stringContaining("지어내지") });
    expect(call.messages[1]).toEqual({ role: "user", content: expect.stringContaining("다이아가 지급되지 않았습니다") });
  });

  it("reports refused when the content filter stops generation mid-stream", async () => {
    createMock.mockResolvedValue(chunks([{ text: "일부 " }, { text: "", finishReason: "content_filter" }]));

    await expect(collect(makeInput())).resolves.toEqual([
      { type: "text", text: "일부 " },
      { type: "error", reason: "refused" },
    ]);
  });

  it("reports refused when the stream ends without any text", async () => {
    createMock.mockResolvedValue(chunks([{ text: undefined, finishReason: "stop" }]));

    await expect(collect(makeInput())).resolves.toEqual([{ type: "error", reason: "refused" }]);
  });

  it("reports failed when the SDK throws before streaming", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createMock.mockRejectedValue(new Error("network down"));

    await expect(collect(makeInput())).resolves.toEqual([{ type: "error", reason: "failed" }]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("reports failed when the stream breaks after some text", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createMock.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: "앞부분" }, finish_reason: null }] };
        throw new Error("connection reset");
      })()
    );

    await expect(collect(makeInput())).resolves.toEqual([
      { type: "text", text: "앞부분" },
      { type: "error", reason: "failed" },
    ]);
    warnSpy.mockRestore();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/lib/suggest.test.ts`
Expected: FAIL — 타입 오류(`sourcesText`, `pastReplies` 형태)와 `openai` 모킹 미사용으로 대부분 실패

- [ ] **Step 3: `lib/suggest.ts` 전체 교체**

```ts
// lib/suggest.ts
import OpenAI from "openai";
import type { PastReply } from "@/lib/replies";
import { EVIDENCE_DELIMITER } from "@/lib/suggest-evidence";

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

export type SuggestErrorReason = "not_configured" | "refused" | "failed";
export type SuggestWarningReason = "sources_unavailable" | "similar_unavailable";

/**
 * 스트리밍 이벤트. warning은 라우트가 근거를 모으다 실패한 것을 본문보다 먼저
 * 알리는 용도이고, 텍스트 조각이 순서대로 온 뒤 문제가 생기면 error 이벤트가
 * 마지막에 온다. error 앞에 이미 나간 텍스트는 그대로 유효하다(관리자가 살릴지
 * 판단한다).
 */
export type SuggestEvent =
  | { type: "text"; text: string }
  | { type: "warning"; reason: SuggestWarningReason; sourceTitle?: string }
  | { type: "error"; reason: SuggestErrorReason };

const DEFAULT_MODEL = "gpt-5-mini";

// 규칙은 모든 게임에 같고 자료는 게임마다 같다. 이 순서로 system을 만들어야
// OpenAI 프롬프트 캐시가 앞부분을 재사용한다.
const SYSTEM_RULES = [
  "당신은 게임사 THE PLAY+의 고객지원 담당자입니다.",
  "접수된 문의에 보낼 답변 메일 본문을 한국어로 작성하세요.",
  "",
  "규칙:",
  "- 메일 본문만 출력하세요. 머리말, 설명, 따옴표, 코드블록을 붙이지 마세요.",
  "- 확인되지 않은 사실을 지어내지 마세요. 보상 지급, 환불 승인, 수정 일정처럼",
  "  확인이 필요한 사항은 약속하지 말고 '확인 후 안내드리겠습니다'로 남기세요.",
  "- 참고 자료에 있는 사실(이벤트 기간, 지급 기준, 운영 정책 등)로 답할 수 있으면",
  "  그 사실을 답변에 쓰세요. 자료에 없는 사실은 지어내지 말고 '확인 후 안내드리겠습니다'로 남기세요.",
  "- 참고 템플릿이 주어지면 그 말투와 구조를 따르세요. 템플릿의 제목은 참고용",
  "  이름일 뿐이니 답변 본문에 옮겨 적지 마세요.",
  "- 과거 문의와 답변이 주어지면 표현 방식과 처리 방향을 참고하되, 그때의 계정·금액·날짜를",
  "  이번 답변에 옮겨 적지 마세요.",
  "- 서명이나 발신자 정보는 붙이지 마세요. 발송 시스템이 처리합니다.",
  "",
  "출력 형식:",
  `- 본문을 다 쓴 뒤 다음 줄에 ${EVIDENCE_DELIMITER} 를 쓰고, 그 아래에 참고한 자료를 한 줄에 하나씩 적으세요.`,
  "  시트는 'VIP 시트 VIP 탭 7행', 문서는 '운영 가이드 문서 환불 항목', 과거 답변은 '과거 답변 R-20260902-0001'처럼 적으세요.",
  "- 참고한 것이 없으면 구분선 아래에 '없음'이라고 적으세요.",
].join("\n");

/**
 * 프롬프트 조립은 이 기능의 핵심 로직이다. API를 때려야만 테스트할 수 있으면
 * 아무도 고치지 못하므로 순수 함수로 분리한다.
 */
export function buildSuggestPrompt(input: SuggestInput): { system: string; userMessage: string } {
  const system = input.sourcesText.trim() === "" ? SYSTEM_RULES : `${SYSTEM_RULES}\n\n# 참고 자료\n\n${input.sourcesText}`;

  const lines: string[] = [
    `게임: ${input.gameName}`,
    `문의 종류: ${input.groupLabel}`,
    `문의 유형: ${input.typeLabel}`,
  ];

  if (input.gameAccount) {
    lines.push(`게임 계정: ${input.gameAccount}`);
  }
  if (input.companyName) {
    lines.push(`회사명: ${input.companyName}`);
  }

  lines.push("", `제목: ${input.title}`, "", "문의 내용:", input.content);

  if (input.templates.length > 0) {
    lines.push("", "---", "참고 템플릿:");
    input.templates.forEach((template, index) => {
      // 제목을 대괄호로 감싸면 모델이 본문 머리말로 오해해 그대로 복사한다
      // (실제로 "[환불 안내]"가 답변 첫 줄에 나왔다). 제목은 라벨로만 적고
      // 본문과 시각적으로 분리한다.
      lines.push("", `${index + 1}) 템플릿 이름: ${template.title}`, "본문:", template.content);
    });
  }

  if (input.pastReplies.length > 0) {
    lines.push("", "---", "과거 문의와 답변:");
    input.pastReplies.forEach((entry, index) => {
      if (entry.inquiryNo) {
        lines.push("", `${index + 1}) 문의 ${entry.inquiryNo}: ${entry.title ?? ""}`.trimEnd());
        if (entry.excerpt) lines.push(`문의 요약: ${entry.excerpt}`);
        lines.push("보낸 답변:", entry.reply);
      } else {
        lines.push("", `${index + 1}) 같은 유형의 최근 답변:`, entry.reply);
      }
    });
  }

  return { system, userMessage: lines.join("\n") };
}

export async function* streamSuggestion(input: SuggestInput): AsyncGenerator<SuggestEvent> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    yield { type: "error", reason: "not_configured" };
    return;
  }

  const { system, userMessage } = buildSuggestPrompt(input);
  let emitted = false;

  try {
    const client = new OpenAI({ apiKey });
    // 관리자가 버튼을 누르고 기다리는 화면이라 한 번에 받으면 몇 초간 아무것도
    // 안 보인다. 조각이 오는 대로 흘려보낸다.
    const stream = await client.chat.completions.create({
      // 모델 이름은 서버 쪽에서 바뀐다. 어시스턴트와 같은 환경변수를 쓴다.
      model: process.env.OPENAI_MODEL ?? DEFAULT_MODEL,
      stream: true,
      // 답변 한 통 쓰는 데 깊은 사고가 필요 없다. gpt-5 계열은 temperature를
      // 기본값 외로 주면 거절하므로 넣지 않는다.
      reasoning_effort: "minimal",
      max_completion_tokens: 2048,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMessage },
      ],
    });

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;

      const text = choice.delta?.content;
      if (text) {
        emitted = true;
        yield { type: "text", text };
      }

      // 콘텐츠 필터 차단은 예외가 아니라 finish_reason으로 온다. 본문 일부가
      // 나간 뒤 중간에 끊길 수도 있다.
      if (choice.finish_reason === "content_filter") {
        yield { type: "error", reason: "refused" };
        return;
      }
    }

    if (!emitted) {
      yield { type: "error", reason: "refused" };
    }
  } catch (error) {
    console.warn("[suggest] OpenAI request failed", error);
    yield { type: "error", reason: "failed" };
  }
}
```

- [ ] **Step 4: Gemini 의존성과 환경변수 제거**

```bash
npm uninstall @google/genai
grep -rn "genai\|GEMINI" --include='*.ts' --include='*.tsx' --include='*.js' --include='*.json' . | grep -v node_modules | grep -v package-lock
```

Expected: `components/inquiries/SuggestButton.tsx`의 오류 문구와 `tests/components/SuggestButton.test.tsx`만 남는다(Task 8에서 고친다). `.env.example`에서 아래 두 줄을 지운다.

```
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash-lite
```

그리고 `.env.example`의 `# 운영 시트 어시스턴트 (OpenAI)` 주석을 `# 운영 시트 어시스턴트·AI 답변 추천 (OpenAI). 추천은 채팅 모델 외에 text-embedding-3-small도 쓴다`로 바꾼다.

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/lib/suggest.test.ts`
Expected: PASS

Run: `npx tsc --noEmit -p .`
Expected: `app/api/inquiries/[id]/suggest/route.ts`에서 `pastReplies`/`sourcesText` 타입 오류만 남는다(Task 7에서 고친다). 다른 오류가 있으면 여기서 고친다.

- [ ] **Step 6: 커밋**

```bash
git add lib/suggest.ts tests/lib/suggest.test.ts package.json package-lock.json .env.example
git commit -m "feat: 답변 추천을 OpenAI로 전환하고 자료·유사 답변·근거 규칙을 프롬프트에 추가"
```

---

### Task 7: 라우트 — 자료·임베딩·유사 답변 수집과 warning 선행 스트림

**Files:**
- Modify: `app/api/inquiries/[id]/suggest/route.ts`
- Test: `tests/api/inquiry-suggest.test.ts`

**Interfaces:**
- Consumes: `ensureInquiryEmbedding` (Task 3), `listSimilarAnsweredReplies`·`mergePastReplies`·`listRecentRepliesByType` (Task 4), `streamSuggestion`·`SuggestEvent` (Task 6), `listSources`·`loadSources`·`serializeSources` (`lib/assistant-sources.ts`, 기존)
- Produces: 같은 NDJSON 응답. 이벤트 순서 `warning*` → `text*` → `error?`

- [ ] **Step 1: 테스트 파일의 모킹과 케이스를 갱신**

`tests/api/inquiry-suggest.test.ts` 상단 import·mock 블록을 아래로 바꾼다.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/inquiries/[id]/suggest/route";
import * as supabaseModule from "@/lib/supabase";
import * as inquiriesModule from "@/lib/inquiries";
import * as categoriesModule from "@/lib/categories";
import * as templatesModule from "@/lib/templates";
import * as repliesModule from "@/lib/replies";
import * as suggestModule from "@/lib/suggest";
import * as sessionModule from "@/lib/require-admin-session";
import * as sourcesModule from "@/lib/assistant-sources";
import * as embeddingsModule from "@/lib/embeddings";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/inquiries", () => ({ getInquiryById: vi.fn() }));
vi.mock("@/lib/categories", () => ({ listCategoryLabelsForScope: vi.fn(), listGames: vi.fn() }));
vi.mock("@/lib/templates", () => ({ listTemplates: vi.fn() }));
// mergePastReplies는 순수 함수라 실제 구현을 쓴다.
vi.mock("@/lib/replies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/replies")>();
  return { ...actual, listRecentRepliesByType: vi.fn(), listSimilarAnsweredReplies: vi.fn() };
});
vi.mock("@/lib/suggest", () => ({ streamSuggestion: vi.fn() }));
vi.mock("@/lib/require-admin-session", () => ({ requireAdminSession: vi.fn() }));
vi.mock("@/lib/assistant-sources", () => ({ listSources: vi.fn(), loadSources: vi.fn(), serializeSources: vi.fn() }));
vi.mock("@/lib/embeddings", () => ({ ensureInquiryEmbedding: vi.fn() }));

const EMBEDDING = [0.1, 0.2, 0.3];
const sheetSource = { id: "src-1", gameId: "game-1", kind: "sheet" as const, externalId: "sh-1", title: "VIP 원장", createdAt: "" };
const loadedSheet = { source: sheetSource, kind: "sheet" as const, tabs: [] };

/** loadSources가 던지는 SheetError를 흉내 낸다. 실제 클래스를 import하면 googleapis가 딸려온다. */
function sourceError(sourceTitle?: string) {
  const error = new Error("source_forbidden") as Error & { reason: string; sourceTitle?: string };
  error.name = "SheetError";
  error.reason = "source_forbidden";
  if (sourceTitle) error.sourceTitle = sourceTitle;
  return error;
}
```

`beforeEach`에 아래를 추가한다(기존 mockReset들 뒤).

```ts
    vi.mocked(repliesModule.listSimilarAnsweredReplies).mockReset().mockResolvedValue([]);
    vi.mocked(sourcesModule.listSources).mockReset().mockResolvedValue([]);
    vi.mocked(sourcesModule.loadSources).mockReset().mockResolvedValue([]);
    vi.mocked(sourcesModule.serializeSources).mockReset().mockReturnValue("");
    vi.mocked(embeddingsModule.ensureInquiryEmbedding).mockReset().mockResolvedValue(EMBEDDING);
```

기존 케이스 중 다음을 고친다.
- "passes Korean labels…": `expect.objectContaining({...})`에 `sourcesText: ""`를 추가한다.
- 서비스 문의 케이스: `expect(repliesModule.listRecentRepliesByType).toHaveBeenCalledWith(expect.anything(), { kind: "service" }, "publishing")`는 그대로 두고, 그 위에 `expect(sourcesModule.listSources).not.toHaveBeenCalled();`와 `expect(repliesModule.listSimilarAnsweredReplies).toHaveBeenCalledWith(expect.anything(), { kind: "service" }, EMBEDDING, "inq-1");`를 추가한다. `objectContaining`에 `sourcesText: ""`를 더한다.

그리고 describe 끝에 새 케이스를 붙인다.

```ts
  it("loads the game's sources and passes the serialized text", async () => {
    vi.mocked(sourcesModule.listSources).mockResolvedValue([sheetSource]);
    vi.mocked(sourcesModule.loadSources).mockResolvedValue([loadedSheet]);
    vi.mocked(sourcesModule.serializeSources).mockReturnValue("# 시트: VIP 원장\n\n## VIP\n…");

    const response = await POST(suggestRequest(), { params: { id: "inq-1" } });

    expect(sourcesModule.listSources).toHaveBeenCalledWith(expect.anything(), "game-1");
    expect(sourcesModule.loadSources).toHaveBeenCalledWith([sheetSource]);
    expect(suggestModule.streamSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({ sourcesText: "# 시트: VIP 원장\n\n## VIP\n…" })
    );
    await expect(readLines(response)).resolves.toEqual([
      { type: "text", text: "추천 " },
      { type: "text", text: "본문" },
    ]);
  });

  it("does not read sources at all when none are registered", async () => {
    await POST(suggestRequest(), { params: { id: "inq-1" } });
    expect(sourcesModule.loadSources).not.toHaveBeenCalled();
  });

  it("warns and continues without sources when loading them fails, naming the source", async () => {
    vi.mocked(sourcesModule.listSources).mockResolvedValue([sheetSource]);
    vi.mocked(sourcesModule.loadSources).mockRejectedValue(sourceError("VIP 원장"));

    const response = await POST(suggestRequest(), { params: { id: "inq-1" } });

    expect(suggestModule.streamSuggestion).toHaveBeenCalledWith(expect.objectContaining({ sourcesText: "" }));
    await expect(readLines(response)).resolves.toEqual([
      { type: "warning", reason: "sources_unavailable", sourceTitle: "VIP 원장" },
      { type: "text", text: "추천 " },
      { type: "text", text: "본문" },
    ]);
  });

  it("omits sourceTitle from the warning when the failure has none", async () => {
    vi.mocked(sourcesModule.listSources).mockResolvedValue([sheetSource]);
    vi.mocked(sourcesModule.loadSources).mockRejectedValue(new Error("boom"));

    const response = await POST(suggestRequest(), { params: { id: "inq-1" } });

    const lines = await readLines(response);
    expect(lines[0]).toEqual({ type: "warning", reason: "sources_unavailable" });
  });

  it("passes similar replies through and skips the recent-reply fallback when there are two or more", async () => {
    const similar = [
      { inquiryNo: "R-1", title: "a", excerpt: "x", reply: "A" },
      { inquiryNo: "R-2", title: "b", excerpt: "y", reply: "B" },
    ];
    vi.mocked(repliesModule.listSimilarAnsweredReplies).mockResolvedValue(similar);

    await POST(suggestRequest(), { params: { id: "inq-1" } });

    expect(embeddingsModule.ensureInquiryEmbedding).toHaveBeenCalledWith(expect.anything(), inquiry);
    expect(repliesModule.listSimilarAnsweredReplies).toHaveBeenCalledWith(expect.anything(), { kind: "game", gameId: "game-1" }, EMBEDDING, "inq-1");
    expect(repliesModule.listRecentRepliesByType).not.toHaveBeenCalled();
    expect(suggestModule.streamSuggestion).toHaveBeenCalledWith(expect.objectContaining({ pastReplies: similar }));
  });

  it("tops up with recent replies of the same type when fewer than two similar ones exist", async () => {
    vi.mocked(repliesModule.listSimilarAnsweredReplies).mockResolvedValue([
      { inquiryNo: "R-1", title: "a", excerpt: "x", reply: "A" },
    ]);
    vi.mocked(repliesModule.listRecentRepliesByType).mockResolvedValue(["A", "C"]);

    await POST(suggestRequest(), { params: { id: "inq-1" } });

    expect(repliesModule.listRecentRepliesByType).toHaveBeenCalledWith(expect.anything(), { kind: "game", gameId: "game-1" }, "payment_refund");
    expect(suggestModule.streamSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        pastReplies: [
          { inquiryNo: "R-1", title: "a", excerpt: "x", reply: "A" },
          { inquiryNo: null, title: null, excerpt: null, reply: "C" },
        ],
      })
    );
  });

  it("warns and uses only recent replies when the embedding could not be made", async () => {
    vi.mocked(embeddingsModule.ensureInquiryEmbedding).mockResolvedValue(null);
    vi.mocked(repliesModule.listRecentRepliesByType).mockResolvedValue(["최근 답변"]);

    const response = await POST(suggestRequest(), { params: { id: "inq-1" } });

    expect(repliesModule.listSimilarAnsweredReplies).not.toHaveBeenCalled();
    expect(suggestModule.streamSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({ pastReplies: [{ inquiryNo: null, title: null, excerpt: null, reply: "최근 답변" }] })
    );
    const lines = await readLines(response);
    expect(lines[0]).toEqual({ type: "warning", reason: "similar_unavailable" });
  });

  it("sends the sources warning before the similar-replies warning, both before any text", async () => {
    vi.mocked(sourcesModule.listSources).mockResolvedValue([sheetSource]);
    vi.mocked(sourcesModule.loadSources).mockRejectedValue(sourceError());
    vi.mocked(embeddingsModule.ensureInquiryEmbedding).mockResolvedValue(null);

    const response = await POST(suggestRequest(), { params: { id: "inq-1" } });

    await expect(readLines(response)).resolves.toEqual([
      { type: "warning", reason: "sources_unavailable" },
      { type: "warning", reason: "similar_unavailable" },
      { type: "text", text: "추천 " },
      { type: "text", text: "본문" },
    ]);
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/api/inquiry-suggest.test.ts`
Expected: 새 케이스들이 FAIL (`listSources` 미호출, warning 없음 등)

- [ ] **Step 3: 라우트 교체**

```ts
// app/api/inquiries/[id]/suggest/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { getInquiryById } from "@/lib/inquiries";
import { listCategoryLabelsForScope, listGames } from "@/lib/categories";
import { scopeForGameId } from "@/lib/inbox-scope";
import { listTemplates, type TemplateRow } from "@/lib/templates";
import {
  listRecentRepliesByType,
  listSimilarAnsweredReplies,
  mergePastReplies,
  type PastReply,
} from "@/lib/replies";
import { listSources, loadSources, serializeSources, type SourceRow } from "@/lib/assistant-sources";
import { ensureInquiryEmbedding } from "@/lib/embeddings";
import { streamSuggestion, type SuggestEvent } from "@/lib/suggest";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  const inquiry = await getInquiryById(supabase, params.id);
  if (!inquiry) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }

  // 서비스 문의(game_id null)는 게임·템플릿·운영 자료가 없다. 라벨과 과거 답변은 서비스 스코프로 찾는다.
  const scope = scopeForGameId(inquiry.gameId);
  const [labels, games, templates, sources, embedding] = await Promise.all([
    listCategoryLabelsForScope(supabase, scope),
    scope.kind === "game" ? listGames(supabase) : Promise.resolve([]),
    scope.kind === "game" ? listTemplates(supabase, scope.gameId) : Promise.resolve([] as TemplateRow[]),
    scope.kind === "game" ? listSources(supabase, scope.gameId).catch(() => [] as SourceRow[]) : Promise.resolve([] as SourceRow[]),
    // 지금 문의의 임베딩을 여기서 만들어 둔다. 답변이 붙으면 바로 다음 문의의 근거가 된다.
    ensureInquiryEmbedding(supabase, inquiry),
  ]);

  const game = scope.kind === "game" ? games.find((entry) => entry.id === scope.gameId) : undefined;

  // 근거를 모으다 실패한 것은 본문보다 먼저 알린다. 화면이 결과를 그만큼만 믿게 하려는 것이다.
  const warnings: SuggestEvent[] = [];

  // 운영 자료는 등록된 게 있을 때만 읽는다. 읽기 실패(공유 안 됨·너무 큼·서비스 계정 없음)는
  // 자료 없이 진행하고 어느 자료인지 알린다.
  let sourcesText = "";
  if (sources.length > 0) {
    try {
      sourcesText = serializeSources(await loadSources(sources));
    } catch (error) {
      const sourceTitle = sourceTitleOf(error);
      warnings.push({ type: "warning", reason: "sources_unavailable", ...(sourceTitle ? { sourceTitle } : {}) });
    }
  }

  // 유사 문의는 임베딩이 있어야 찾는다. 없으면 같은 유형 최근 답변만 쓴다.
  let similar: PastReply[] = [];
  if (embedding) {
    similar = await listSimilarAnsweredReplies(supabase, scope, embedding, inquiry.id);
  } else {
    warnings.push({ type: "warning", reason: "similar_unavailable" });
  }
  const recent = similar.length < 2 ? await listRecentRepliesByType(supabase, scope, inquiry.typeKey) : [];
  const pastReplies = mergePastReplies(similar, recent);

  // 해당 유형 템플릿 + 공용 템플릿(type_key가 null)만 근거로 넘긴다.
  const relevant = templates.filter(
    (template) => template.typeKey === null || template.typeKey === inquiry.typeKey
  );

  const events = withWarnings(
    warnings,
    streamSuggestion({
      gameName: game?.name ?? "",
      groupLabel: labels.groupLabels[inquiry.groupKey] ?? inquiry.groupKey,
      typeLabel: labels.typeLabels[inquiry.typeKey] ?? inquiry.typeKey,
      title: inquiry.title,
      content: inquiry.content,
      gameAccount: inquiry.gameAccount,
      companyName: inquiry.companyName,
      templates: relevant.map((template) => ({ title: template.title, content: template.content })),
      pastReplies,
      sourcesText,
    })
  );

  // 추천은 이력에 남기지 않는다 — 초안 생성일 뿐이고 여러 번 눌린다.
  //
  // 한 줄에 이벤트 하나(NDJSON). 텍스트 조각은 오는 대로 내려보내고, 실패 원인
  // (not_configured / refused / failed)도 같은 스트림의 error 이벤트로 내려야
  // 화면이 관리자에게 무엇을 고쳐야 할지 알려줄 수 있다. 본문이 이미 일부 나간
  // 뒤에는 상태 코드를 바꿀 수 없기 때문이다.
  return new Response(toNdjsonStream(events), {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

/** SheetError의 sourceTitle. 클래스를 import하면 googleapis가 딸려오므로 모양만 본다. */
function sourceTitleOf(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "sourceTitle" in error) {
    const title = (error as { sourceTitle?: unknown }).sourceTitle;
    return typeof title === "string" && title !== "" ? title : undefined;
  }
  return undefined;
}

async function* withWarnings(warnings: SuggestEvent[], events: AsyncGenerator<SuggestEvent>): AsyncGenerator<SuggestEvent> {
  for (const warning of warnings) yield warning;
  yield* events;
}

function toNdjsonStream(events: AsyncGenerator<SuggestEvent>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await events.next();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
    },
    async cancel() {
      await events.return(undefined);
    },
  });
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/api/inquiry-suggest.test.ts`
Expected: PASS

Run: `npx tsc --noEmit -p .`
Expected: 오류 없음

- [ ] **Step 5: 커밋**

```bash
git add "app/api/inquiries/[id]/suggest/route.ts" tests/api/inquiry-suggest.test.ts
git commit -m "feat: 추천 라우트가 운영 자료·유사 답변을 모으고 실패는 warning으로 먼저 알린다"
```

---

### Task 8: `SuggestButton` — 근거 분리 표시·경고 안내줄·오류 문구

**Files:**
- Modify: `components/inquiries/SuggestButton.tsx`
- Test: `tests/components/SuggestButton.test.tsx`

**Interfaces:**
- Consumes: `splitSuggestion`·`EVIDENCE_DELIMITER` (Task 5), `SuggestEvent` 타입 (Task 6, `import type`만)
- Produces: 같은 props (`inquiryId`, `onApply`). `onApply`에는 구분선 앞 본문만 trim해서 넘긴다.

- [ ] **Step 1: 테스트 갱신**

`tests/components/SuggestButton.test.tsx`에서 `Event` 타입을 바꾸고, `GEMINI_API_KEY` 케이스를 고치고, 새 케이스를 붙인다.

```ts
type Event =
  | { type: "text"; text: string }
  | { type: "warning"; reason: string; sourceTitle?: string }
  | { type: "error"; reason: string };
```

기존 "tells the admin the API key is missing"의 기대를 `expect(await screen.findByText(/OPENAI_API_KEY/)).toBeInTheDocument();`로 바꾼다.

describe 끝에 추가:

```ts
  it("shows the evidence apart from the body and applies only the body", async () => {
    mockStreamOnce([
      { type: "text", text: "안녕하세요, 확인 후 안내드리겠습니다.\n" },
      { type: "text", text: "=== 근거 ===\n- VIP 시트 VIP 탭 7행\n- 과거 답변 R-20260902-0001" },
    ]);
    const onApply = vi.fn();
    render(<SuggestButton inquiryId="inq-1" onApply={onApply} />);

    await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));

    expect(await screen.findByText("참고한 자료")).toBeInTheDocument();
    expect(screen.getByText("VIP 시트 VIP 탭 7행")).toBeInTheDocument();
    expect(screen.getByText("과거 답변 R-20260902-0001")).toBeInTheDocument();
    expect(screen.queryByText(/=== 근거 ===/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "적용" }));
    expect(onApply).toHaveBeenCalledWith("안녕하세요, 확인 후 안내드리겠습니다.");
  });

  it("hides the evidence heading when the model reports none", async () => {
    mockStreamOnce([{ type: "text", text: `${FULL}\n=== 근거 ===\n없음` }]);
    render(<SuggestButton inquiryId="inq-1" onApply={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));

    expect(await screen.findByRole("button", { name: "적용" })).toBeInTheDocument();
    expect(screen.queryByText("참고한 자료")).not.toBeInTheDocument();
  });

  it("shows a warning line naming the source that could not be read", async () => {
    mockStreamOnce([
      { type: "warning", reason: "sources_unavailable", sourceTitle: "VIP 원장" },
      { type: "text", text: FULL },
    ]);
    render(<SuggestButton inquiryId="inq-1" onApply={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));

    expect(await screen.findByText("운영 자료를 읽지 못해 자료 없이 작성했습니다. (자료: VIP 원장)")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "적용" })).toBeInTheDocument();
  });

  it("shows a warning line when similar replies could not be searched", async () => {
    mockStreamOnce([{ type: "warning", reason: "similar_unavailable" }, { type: "text", text: FULL }]);
    render(<SuggestButton inquiryId="inq-1" onApply={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));

    expect(await screen.findByText("유사 문의 검색이 안 돼 같은 유형의 최근 답변만 참고했습니다.")).toBeInTheDocument();
  });

  it("clears warnings when a new suggestion is requested", async () => {
    mockStreamOnce([{ type: "warning", reason: "similar_unavailable" }, { type: "text", text: FULL }]);
    render(<SuggestButton inquiryId="inq-1" onApply={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));
    expect(await screen.findByText(/유사 문의 검색이 안 돼/)).toBeInTheDocument();

    mockStreamOnce([{ type: "text", text: FULL }]);
    await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));
    await screen.findByRole("button", { name: "적용" });
    expect(screen.queryByText(/유사 문의 검색이 안 돼/)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/SuggestButton.test.tsx`
Expected: 새 케이스와 OPENAI_API_KEY 케이스 FAIL

- [ ] **Step 3: 컴포넌트 교체**

```tsx
// components/inquiries/SuggestButton.tsx
"use client";

import { useState } from "react";
import { readNdjson } from "@/lib/ndjson";
import type { SuggestEvent } from "@/lib/suggest";
import { splitSuggestion } from "@/lib/suggest-evidence";
import StatusMessage from "@/components/ui/StatusMessage";

// 실패 원인을 구분해 보여줘야 관리자가 무엇을 고쳐야 할지 안다.
const ERROR_MESSAGES: Record<string, string> = {
  not_configured: "OPENAI_API_KEY가 설정되지 않았습니다.",
  refused: "안전 필터에 걸려 추천을 만들지 못했습니다.",
  not_found: "문의를 찾을 수 없습니다.",
};

const GENERIC_ERROR = "추천 생성에 실패했습니다.";

// 근거를 못 모은 채 만든 추천은 그만큼만 믿어야 한다. 본문 위에 알린다.
function warningMessage(event: Extract<SuggestEvent, { type: "warning" }>): string {
  if (event.reason === "sources_unavailable") {
    const suffix = event.sourceTitle ? ` (자료: ${event.sourceTitle})` : "";
    return `운영 자료를 읽지 못해 자료 없이 작성했습니다.${suffix}`;
  }
  return "유사 문의 검색이 안 돼 같은 유형의 최근 답변만 참고했습니다.";
}

function isSuggestEvent(value: unknown): value is SuggestEvent {
  return typeof value === "object" && value !== null && "type" in value;
}

export default function SuggestButton({
  inquiryId,
  onApply,
}: {
  inquiryId: string;
  onApply: (text: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  // 모델이 준 전체 텍스트(근거 포함). 본문/근거는 그릴 때마다 나눈다.
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function handleSuggest() {
    setLoading(true);
    setError(null);
    setWarnings([]);
    setSuggestion(null);

    let text = "";
    let failure: string | null = null;

    try {
      const response = await fetch(`/api/inquiries/${inquiryId}/suggest`, { method: "POST" });

      // 세션 없음/문의 없음처럼 스트림을 열기 전에 거절된 경우는 JSON 한 덩어리다.
      if (!response.ok || !response.body) {
        const json = (await response.json()) as { error?: string };
        failure = json.error ?? "failed";
      } else {
        for await (const event of readNdjson(response.body)) {
          if (!isSuggestEvent(event)) continue;
          if (event.type === "text") {
            text += event.text;
            // 조각이 올 때마다 미리보기를 갱신해 생성 과정이 보이게 한다.
            setSuggestion(text);
          } else if (event.type === "warning") {
            setWarnings((current) => [...current, warningMessage(event)]);
          } else {
            failure = event.reason;
          }
        }
      }
    } catch {
      failure = "failed";
    }

    setLoading(false);

    if (failure) {
      setError(ERROR_MESSAGES[failure] ?? GENERIC_ERROR);
    }

    // 중간에 끊겨도 이미 받은 부분은 관리자가 살릴 수 있게 남긴다.
    setSuggestion(text.trim() ? text : null);
  }

  const parsed = suggestion === null ? null : splitSuggestion(suggestion);
  const body = parsed ? parsed.body.trim() : "";
  const evidence = parsed ? parsed.evidence : [];

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleSuggest}
        disabled={loading}
        className="self-start border border-line rounded-lg px-3 py-1.5 text-sm hover:bg-ground disabled:opacity-50 transition-colors"
      >
        {loading ? "추천 생성 중…" : "AI 답변 추천"}
      </button>

      <StatusMessage className="text-sm">{error}</StatusMessage>

      {warnings.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-amber-700" role="status">
          {warnings.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      {/* 작성 중인 글을 말없이 덮어쓰지 않도록 미리보기를 거친다. */}
      {parsed && (
        <div className="border border-line rounded-lg p-3 bg-ground">
          {/* 살아 있는 영역은 상태 줄에만 둔다. 본문까지 live면 조각이 올 때마다 전체를 다시 읽는다. */}
          <p className="text-xs text-muted mb-2" role="status" aria-live="polite">
            {loading ? "추천 답변 생성 중…" : "추천 답변 (아직 적용되지 않았습니다)"}
          </p>
          <p className="whitespace-pre-wrap break-words text-sm" aria-busy={loading || undefined}>
            {body}
            {loading && <span className="inline-block w-[2px] h-[1em] align-text-bottom bg-accent ml-0.5 animate-pulse motion-reduce:animate-none" aria-hidden="true" />}
          </p>
          {/* 시트 사실이 맞는지 관리자가 바로 확인하도록 근거는 본문과 떼어 보여준다. 답변에는 안 들어간다. */}
          {evidence.length > 0 && (
            <div className="mt-3 text-xs text-muted">
              <p className="font-medium">참고한 자료</p>
              <ul className="mt-1 list-disc pl-4">
                {evidence.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {/* 생성이 끝나기 전에는 적용하지 못하게 한다. 반쯤 온 글을 적용하면
              나머지가 어디로 갔는지 관리자가 알 수 없다. */}
          {!loading && (
            <div className="flex items-center gap-2 mt-3">
              <button
                type="button"
                onClick={() => {
                  onApply(body);
                  setSuggestion(null);
                }}
                className="border border-line rounded-lg px-3 py-1 text-sm hover:bg-panel transition-colors"
              >
                적용
              </button>
              <button
                type="button"
                onClick={() => setSuggestion(null)}
                className="text-sm text-muted hover:text-ink transition-colors"
              >
                버리기
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/components/SuggestButton.test.tsx`
Expected: PASS. 기존 "trims surrounding whitespace" 케이스는 `body.trim()`으로 그대로 통과한다.

Run: `grep -rn "GEMINI\|genai" --include='*.ts' --include='*.tsx' . | grep -v node_modules`
Expected: 출력 없음

- [ ] **Step 5: 커밋**

```bash
git add components/inquiries/SuggestButton.tsx tests/components/SuggestButton.test.tsx
git commit -m "feat: 추천 미리보기가 근거를 본문과 나눠 보여주고 근거 수집 실패를 알린다"
```

---

### Task 9: 수동 발송 뒤 임베딩 보장

**Files:**
- Modify: `lib/send-reply.ts`
- Test: `tests/lib/send-reply.test.ts`

**Interfaces:**
- Consumes: `ensureInquiryEmbedding` (Task 3)

- [ ] **Step 1: 테스트 추가**

`tests/lib/send-reply.test.ts` 상단에 mock과 import를 더한다.

```ts
import * as embeddingsModule from "@/lib/embeddings";
vi.mock("@/lib/embeddings", () => ({ ensureInquiryEmbedding: vi.fn() }));
```

`beforeEach`에 `vi.mocked(embeddingsModule.ensureInquiryEmbedding).mockReset().mockResolvedValue([0.1]);`를 추가하고, describe 끝에 붙인다.

```ts
  it("manual: makes sure the inquiry has an embedding after the reply is recorded", async () => {
    const { supabase } = mockSupabase();

    await sendInquiryReply(supabase, { inquiry, body: "환불 처리했습니다", mode: "manual", actor: ADMIN });

    expect(embeddingsModule.ensureInquiryEmbedding).toHaveBeenCalledWith(supabase, {
      id: "inq-1",
      title: "중복 결제",
      content: "두 번 결제됐어요",
    });
  });

  it("auto: does not touch the embedding", async () => {
    const { supabase } = mockSupabase();

    await sendInquiryReply(supabase, { inquiry, body: "접수됐습니다", mode: "auto" });

    expect(embeddingsModule.ensureInquiryEmbedding).not.toHaveBeenCalled();
  });

  it("manual: an embedding failure does not change the result", async () => {
    vi.mocked(embeddingsModule.ensureInquiryEmbedding).mockRejectedValue(new Error("boom"));
    const { supabase } = mockSupabase();

    const result = await sendInquiryReply(supabase, { inquiry, body: "환불 처리했습니다", mode: "manual", actor: ADMIN });

    expect(result.recorded).toBe(true);
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/lib/send-reply.test.ts`
Expected: 첫 번째 새 케이스 FAIL (`ensureInquiryEmbedding` 미호출)

- [ ] **Step 3: 구현**

`lib/send-reply.ts` import에 `import { ensureInquiryEmbedding } from "@/lib/embeddings";`를 추가하고, `recordEvent(...)` 호출 뒤(`return { sent, recorded };` 앞)에 넣는다.

```ts
  // 답변이 붙은 문의는 다음 추천의 근거가 된다. 임베딩이 없으면 여기서 만든다.
  // 부가 작업이라 실패해도 발송 결과에는 영향이 없다.
  if (input.mode === "manual") {
    await ensureInquiryEmbedding(supabase, { id: inquiry.id, title: inquiry.title, content: inquiry.content }).catch(() => null);
  }
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/lib/send-reply.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/send-reply.ts tests/lib/send-reply.test.ts
git commit -m "feat: 수동 답변 발송 뒤 문의 임베딩을 채운다"
```

---

### Task 10: 백필 스크립트

**Files:**
- Create: `scripts/backfill-inquiry-embeddings.js`
- Test: `tests/scripts/backfill-embeddings.test.ts` (텍스트 규칙만)

**Interfaces:**
- Produces: `node scripts/backfill-inquiry-embeddings.js`. 모듈로 `embeddingText(title, content)`와 `EMBEDDING_MAX_CHARS`를 export해 규칙이 `lib/embeddings.ts`와 같은지 테스트한다.

- [ ] **Step 1: 테스트 작성**

```ts
// tests/scripts/backfill-embeddings.test.ts
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { EMBEDDING_MAX_CHARS, EMBEDDING_MODEL, inquiryEmbeddingText } from "@/lib/embeddings";

const require = createRequire(import.meta.url);
const script = require("../../scripts/backfill-inquiry-embeddings.js") as {
  embeddingText: (title: string, content: string) => string;
  EMBEDDING_MAX_CHARS: number;
  EMBEDDING_MODEL: string;
};

describe("backfill-inquiry-embeddings", () => {
  it("builds the same text as lib/embeddings so stored vectors are comparable", () => {
    const long = "가".repeat(EMBEDDING_MAX_CHARS + 50);
    expect(script.embeddingText(" 제목 ", "본문\n")).toBe(inquiryEmbeddingText({ title: " 제목 ", content: "본문\n" }));
    expect(script.embeddingText("제목", long)).toBe(inquiryEmbeddingText({ title: "제목", content: long }));
    expect(script.EMBEDDING_MAX_CHARS).toBe(EMBEDDING_MAX_CHARS);
    expect(script.EMBEDDING_MODEL).toBe(EMBEDDING_MODEL);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/scripts/backfill-embeddings.test.ts`
Expected: FAIL — 스크립트 파일 없음

- [ ] **Step 3: 스크립트 작성**

```js
// scripts/backfill-inquiry-embeddings.js
/**
 * 1회성 유틸: 이미 답변이 붙은 문의의 임베딩을 채운다(AI 답변 추천의 유사 문의 검색용).
 *
 * 사용법: .env.local에 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY를 채워둔 뒤
 *   node scripts/backfill-inquiry-embeddings.js
 *
 * 대상은 reply_content가 있고 임베딩이 없거나 다른 모델로 만든 문의다. 100건씩
 * 읽어 embeddings API에 한 번에 보내고 행마다 저장한다. 실패한 문의는 id를 stderr에
 * 남기고 계속 진행하며, 다시 실행하면 남은 것만 처리한다.
 *
 * lib/embeddings.ts를 import하지 않는다(TS·경로 별칭). 텍스트 규칙(제목+빈 줄+본문,
 * 8000자)은 그 파일과 같아야 하며 tests/scripts/backfill-embeddings.test.ts가 확인한다.
 */
const fs = require("fs");
const path = require("path");

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const EMBEDDING_MAX_CHARS = 8000;
const PAGE_SIZE = 100;

function embeddingText(title, content) {
  const text = `${String(title).trim()}\n\n${String(content).trim()}`;
  return text.length > EMBEDDING_MAX_CHARS ? text.slice(0, EMBEDDING_MAX_CHARS) : text;
}

function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (!process.env[key]) process.env[key] = value.trim();
  }
}

async function fetchPage(supabase) {
  const { data, error } = await supabase
    .from("inquiries")
    .select("id, title, content")
    .not("reply_content", "is", null)
    .or(`embedding.is.null,embedding_model.neq.${EMBEDDING_MODEL}`)
    .order("created_at", { ascending: true })
    .limit(PAGE_SIZE);
  if (error) throw new Error(`inquiries 조회 실패: ${error.message}`);
  return data ?? [];
}

async function main() {
  loadEnvLocal();

  const { createClient } = require("@supabase/supabase-js");
  const OpenAI = require("openai").default;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!url || !key || !apiKey) {
    console.error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY가 필요합니다.");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const openai = new OpenAI({ apiKey });

  let done = 0;
  const failed = [];

  while (true) {
    const rows = await fetchPage(supabase);
    // 저장에 실패한 행은 다음 페이지에도 다시 나온다. 전부 실패면 멈춘다.
    const pending = rows.filter((row) => !failed.includes(row.id));
    if (pending.length === 0) break;

    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: pending.map((row) => embeddingText(row.title ?? "", row.content ?? "")),
      dimensions: EMBEDDING_DIMENSIONS,
    });

    for (const item of response.data) {
      const row = pending[item.index];
      const { error } = await supabase
        .from("inquiries")
        .update({ embedding: item.embedding, embedding_model: EMBEDDING_MODEL })
        .eq("id", row.id);
      if (error) {
        failed.push(row.id);
        console.error(`저장 실패 ${row.id}: ${error.message}`);
      } else {
        done += 1;
      }
    }

    console.log(`처리 ${done}건, 실패 ${failed.length}건`);
  }

  console.log(`완료: ${done}건 저장, ${failed.length}건 실패`);
  if (failed.length > 0) {
    console.error(`실패한 문의 id:\n${failed.join("\n")}`);
    process.exit(1);
  }
}

module.exports = { embeddingText, EMBEDDING_MAX_CHARS, EMBEDDING_MODEL };

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/scripts/backfill-embeddings.test.ts`
Expected: PASS

Run: `node scripts/backfill-inquiry-embeddings.js`
Expected(로컬에 `.env.local`이 없거나 키가 비었을 때): `SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY가 필요합니다.` 후 종료 코드 1. 키가 있으면 실제 백필이 돌므로, 실행 전에 사용자에게 확인한다.

- [ ] **Step 5: 커밋**

```bash
git add scripts/backfill-inquiry-embeddings.js tests/scripts/backfill-embeddings.test.ts
git commit -m "feat: 답변 완료 문의 임베딩 백필 스크립트"
```

---

### Task 11: 문서 갱신과 전체 검증

**Files:**
- Modify: `CLAUDE.md`, `docs/PRD.md`

- [ ] **Step 1: `CLAUDE.md` 핵심 기능에 항목 추가**

8번(운영 시트 어시스턴트) 뒤에 9번을 추가한다.

```markdown
9. **AI 답변 추천** — 대화 열의 "AI 답변 추천"이 `POST /api/inquiries/{id}/suggest`로 답변 초안을 스트리밍한다(NDJSON, `lib/suggest.ts`). 모델은 어시스턴트와 같은 OpenAI(`OPENAI_API_KEY`, `OPENAI_MODEL` 기본 `gpt-5-mini`, `reasoning_effort: minimal`). 근거 세 가지를 프롬프트에 넣는다: (1) 유형 템플릿, (2) **유사 과거 답변** — 문의 제목+본문을 `text-embedding-3-small`로 임베딩해 `inquiries.embedding`(pgvector, 마이그레이션 0020)에 저장하고 `match_answered_inquiries` RPC로 같은 스코프(게임 하나 또는 서비스 문의)에서 유사도 0.35 이상 상위 5건의 "문의 요약 + 첫 수동 답변"을 가져오며 2건 미만이면 같은 유형 최근 3건으로 보충(`lib/embeddings.ts`, `lib/replies.ts`), (3) **운영 자료** — 게임 문의면 어시스턴트에 연결된 시트·문서 전부를 `loadSources`로 읽어 system 프롬프트 뒤에 싣는다(서비스 문의는 없음). 임베딩은 추천 클릭 시와 수동 답변 발송 시 채우고, 기존 문의는 `scripts/backfill-inquiry-embeddings.js`로 한 번 채운다. 모델은 본문 뒤에 `=== 근거 ===` 구분선과 참고 자료 목록을 쓰고, 화면은 본문만 적용하며 근거는 미리보기 아래에 보여준다(`lib/suggest-evidence.ts`). 자료 읽기 실패·임베딩 실패는 `warning` 이벤트로 본문보다 먼저 내려가고 추천은 계속 만든다. 막히는 건 API 키 없음뿐이다. 설계는 `docs/superpowers/specs/2026-09-07-openai-suggest-design.md`.
```

"상세 설계는 …" 줄 끝에 `, AI 답변 추천은 \`docs/superpowers/specs/2026-09-07-openai-suggest-design.md\``를 덧붙인다.

- [ ] **Step 2: `CLAUDE.md`에 설정 절차 추가**

"운영 시트 어시스턴트 설정 절차" 절 뒤에 넣는다.

```markdown
## AI 답변 추천 설정 절차

1. `OPENAI_API_KEY`가 설정돼 있어야 한다(어시스턴트와 공유). Gemini 키는 더 이상 쓰지 않는다
2. Supabase SQL Editor에서 `0020_inquiry_embeddings.sql`을 실행한다. pgvector 확장, `inquiries.embedding`·`embedding_model` 열, HNSW 인덱스, `match_answered_inquiries` RPC를 만든다
3. 로컬에서 `.env.local`에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`를 두고 `node scripts/backfill-inquiry-embeddings.js`를 한 번 실행해 답변이 있는 기존 문의의 임베딩을 채운다. 다시 실행하면 남은 것만 처리한다
4. 문의함에서 "AI 답변 추천"을 눌러 미리보기 아래 "참고한 자료"에 시트·과거 답변이 보이는지, 자료 읽기 실패 시 노란 안내가 뜨는지 확인한다
```

- [ ] **Step 3: `docs/PRD.md` 갱신**

- 라우트 표의 `POST /api/inquiries/[id]/suggest` 설명을 `AI 답변 추천 (OpenAI 스트리밍, 유사 답변·운영 자료 근거)`로.
- "핵심 함수" 절(`buildSuggestPrompt()` 언급이 있는 곳)에 `splitSuggestion()` — 본문/근거 분리, `ensureInquiryEmbedding()` — 문의 임베딩 보장, `mergePastReplies()` — 유사/최근 답변 병합 세 줄을 같은 형식으로 추가한다.

- [ ] **Step 4: 전체 검증**

```bash
npx tsc --noEmit -p .
npx vitest run
npx next build 2>&1 | tail -20
```

Expected: 타입 오류 없음, 테스트 전부 통과(78+3 파일), 빌드 성공. 빌드에서 `openai`가 클라이언트 번들에 들어갔다는 경고(`Module not found` 또는 node 전용 모듈 오류)가 나면 `SuggestButton.tsx`가 `@/lib/suggest`를 `import type`으로만 쓰는지 확인한다.

- [ ] **Step 5: 커밋**

```bash
git add CLAUDE.md docs/PRD.md
git commit -m "docs: AI 답변 추천(OpenAI·유사 답변·운영 자료) 기능과 설정 절차"
```

---

## 실행 후 확인(사람이 한다)

1. Supabase에서 0020 실행 → 백필 스크립트 실행.
2. 자료가 연결된 게임의 문의에서 추천 → 근거 목록에 시트 행이 보이는지, 시트 사실이 본문에 들어갔는지.
3. 서비스 문의에서 추천 → 자료 경고 없이 동작.
4. `GOOGLE_SERVICE_ACCOUNT_JSON`을 잠시 비우고 추천 → "운영 자료를 읽지 못해…" 안내가 뜨고 본문은 나오는지.
