# 문의 상세 개편 3단계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 답변 템플릿(게임별·유형별)과 Gemini 기반 답변 추천을 문의 상세에 추가한다.

**Architecture:** 템플릿을 먼저 만들고 추천이 그것을 읽는다 — 템플릿이 "우리 팀 말투"의 근거가 되어 추천 품질을 올린다. 프롬프트 조립은 순수 함수 `buildSuggestPrompt`로 분리해 API 호출 없이 테스트한다. 추천은 편의 기능이므로 실패해도 답변 작성을 막지 않는다.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind, Supabase(service-role), zod, `@google/genai`, Vitest + RTL

**Spec:** `docs/superpowers/specs/2026-09-02-inquiry-detail-phase3-design.md`

## Global Constraints

- 관리자 UI는 **한국어 전용**.
- 모델은 `process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite"`. 모델 ID를 코드에 하드코딩하지 마라.
- **테스트는 절대 실제 Gemini API를 호출하지 않는다.** `@google/genai`를 `vi.mock`으로 대체한다.
- 추천 실패가 답변 작성을 막아서는 안 된다. 화면은 에러 문구만 띄우고 아무것도 잠그지 않는다.
- 안전 필터 차단은 예외가 아니라 정상 응답으로 온다 — `finishReason`이 `SAFETY`/`RECITATION`이거나 `text`가 비면 `refused`.
- `reply_templates`는 RLS를 켜고 **정책을 두지 않는다**. 트리거가 없으므로 `security definer`는 불필요.
- **`app/(admin)/games/[gameId]/inquiries/page.tsx`와 `components/layout/GameRail.tsx`를 절대 수정하지 마라.** 사용자의 미커밋 작업이 들어 있다. 템플릿 페이지 진입 링크는 이번 범위 밖이다.
- `git add`에 디렉터리를 통째로 넘기지 마라 (`git add tests/components` 금지). 파일을 하나씩 명시한다 — 미커밋 작업이 딸려 들어간다.
- 카드 스타일 `bg-panel border border-line rounded-2xl p-4`, 색상은 토큰만.
- 템플릿 수정 기능, 정렬 UI, 추천 후보 여러 개, 자동 추천은 **범위 밖**이다.

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `supabase/migrations/0004_reply_templates.sql` | `reply_templates` 테이블 + RLS | 생성 |
| `.env.example` | `GEMINI_API_KEY`, `GEMINI_MODEL` | 수정 |
| `lib/templates.ts` | 템플릿 조회·생성·삭제 | 생성 |
| `lib/replies.ts` | 같은 유형의 최근 발송 답변 조회 | 생성 |
| `lib/suggest.ts` | 프롬프트 조립(순수) + Gemini 호출 | 생성 |
| `app/api/games/[gameId]/templates/route.ts` | 템플릿 추가 POST | 생성 |
| `app/api/templates/[id]/route.ts` | 템플릿 삭제 DELETE | 생성 |
| `app/api/inquiries/[id]/suggest/route.ts` | 추천 생성 POST | 생성 |
| `app/(admin)/games/[gameId]/templates/page.tsx` | 템플릿 관리 페이지 | 생성 |
| `components/templates/TemplateManager.tsx` | 목록·추가·삭제 | 생성 |
| `components/inquiries/TemplatePicker.tsx` | 템플릿 선택 드롭다운 | 생성 |
| `components/inquiries/SuggestButton.tsx` | 추천 버튼 + 미리보기 | 생성 |
| `components/inquiries/ReplyForm.tsx` | 위 둘 통합, 본문 상태 소유 | 수정 |
| `app/(admin)/inquiries/[id]/page.tsx` | 템플릿 조회와 배선 | 수정 |

**의존성 순서:** Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10.

---

### Task 1: 마이그레이션과 환경변수

**Files:** Create `supabase/migrations/0004_reply_templates.sql`; Modify `.env.example`

- [ ] **Step 1: 마이그레이션 작성**

```sql
-- 답변 템플릿. 게임별로 관리하고 type_key로 문의 유형에 선택적으로 연결한다.
--
-- type_key가 null이면 그 게임의 모든 유형에 쓰이는 공용 템플릿이다.
-- inquiry_types에 FK를 걸지 않는 이유: inquiry_types는 (group_id, key)로
-- 식별되고 inquiries 자신도 type_key를 문자열로만 들고 있다. 여기만 FK를
-- 거는 것은 일관성을 해친다.
--
-- RLS를 켜고 정책은 두지 않는다 — service-role만 접근하고 트리거가 없으니
-- 2단계의 inquiry_notes와 달리 security definer 함수도 필요 없다.

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

- [ ] **Step 2: `.env.example`에 두 줄 추가** (`GMAIL_SENDER` 아래)

```
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash-lite
```

- [ ] **Step 3: 로컬 Postgres에서 재실행 확인** — 2단계 Task 1과 같은 절차. `games` 테이블만 있으면 된다. 두 회차 모두 exit 0이어야 한다.

- [ ] **Step 4: 커밋** `git add supabase/migrations/0004_reply_templates.sql .env.example`

---

### Task 2: `lib/templates.ts`

**Files:** Create `lib/templates.ts`, `tests/lib/templates.test.ts`

**Produces:**
- `interface TemplateRow { id: string; typeKey: string | null; title: string; content: string }`
- `listTemplates(supabase, gameId): Promise<TemplateRow[]>` — `sort_order`, `created_at` 오름차순
- `createTemplate(supabase, { gameId, typeKey, title, content }): Promise<boolean>`
- `deleteTemplate(supabase, id): Promise<boolean>`

- [ ] **Step 1: 실패하는 테스트** — `lib/notes.ts` 테스트와 같은 모킹 패턴. 검증 항목: `from("reply_templates")`, `eq("game_id", ...)`, `order` 2회 호출, 매핑 결과, 조회 에러 시 `[]`, 생성 인자(`type_key`가 `null`일 때 그대로 `null`), 생성/삭제 실패 시 `false`.

- [ ] **Step 2: 실패 확인** `npx vitest run tests/lib/templates.test.ts`

- [ ] **Step 3: 구현**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export interface TemplateRow {
  id: string;
  typeKey: string | null;
  title: string;
  content: string;
}

export interface CreateTemplateInput {
  gameId: string;
  typeKey: string | null;
  title: string;
  content: string;
}

export async function listTemplates(supabase: SupabaseClient, gameId: string): Promise<TemplateRow[]> {
  const { data, error } = await supabase
    .from("reply_templates")
    .select("id, type_key, title, content")
    .eq("game_id", gameId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error || !data) {
    return [];
  }

  return data.map((row) => ({
    id: row.id,
    typeKey: row.type_key,
    title: row.title,
    content: row.content,
  }));
}

/** 메모와 같이 성공 여부를 돌려준다. 방금 만든 템플릿이 조용히 사라지면 안 된다. */
export async function createTemplate(supabase: SupabaseClient, input: CreateTemplateInput): Promise<boolean> {
  const { error } = await supabase.from("reply_templates").insert({
    game_id: input.gameId,
    type_key: input.typeKey,
    title: input.title,
    content: input.content,
  });
  return !error;
}

export async function deleteTemplate(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { error } = await supabase.from("reply_templates").delete().eq("id", id);
  return !error;
}
```

- [ ] **Step 4: 통과 확인 · Step 5: 커밋**

---

### Task 3: `lib/replies.ts`

**Files:** Create `lib/replies.ts`, `tests/lib/replies.test.ts`

**Produces:** `listRecentRepliesByType(supabase, gameId, typeKey, limit?): Promise<string[]>`

- [ ] **Step 1: 실패하는 테스트** — 검증 항목: `from("inquiries")`, `eq("game_id", ...)`, `eq("type_key", ...)`, `not("reply_content", "is", null)`, `order("replied_at", { ascending: false })`, `limit(3)`, 본문 문자열 배열 반환, 에러 시 `[]`, `null`/빈 문자열 본문은 제외.

- [ ] **Step 2: 실패 확인**

- [ ] **Step 3: 구현**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 같은 게임·같은 유형에서 이미 발송된 답변 본문. 추천 프롬프트가 우리 팀
 * 말투를 따라가게 하는 근거로 쓴다.
 */
export async function listRecentRepliesByType(
  supabase: SupabaseClient,
  gameId: string,
  typeKey: string,
  limit = 3
): Promise<string[]> {
  const { data, error } = await supabase
    .from("inquiries")
    .select("reply_content")
    .eq("game_id", gameId)
    .eq("type_key", typeKey)
    .not("reply_content", "is", null)
    .order("replied_at", { ascending: false })
    .limit(limit);

  if (error || !data) {
    return [];
  }

  return data
    .map((row) => row.reply_content as string | null)
    .filter((content): content is string => typeof content === "string" && content.trim() !== "");
}
```

- [ ] **Step 4: 통과 확인 · Step 5: 커밋**

---

### Task 4: `lib/suggest.ts`

**Files:** Create `lib/suggest.ts`, `tests/lib/suggest.test.ts`

**Produces:** `SuggestInput`, `buildSuggestPrompt`, `requestSuggestion`

`buildSuggestPrompt`가 이 기능의 핵심이다. 프롬프트를 컴포넌트나 라우트에 인라인으로 두면 테스트할 수 없다.

- [ ] **Step 1: 실패하는 테스트**

검증 항목:
- `system`이 "지어내지" / "확인 후" 지시와 "한국어" 지시를 담는다
- `userMessage`가 게임명·종류·유형·제목·본문을 담는다
- `gameAccount`/`companyName`이 있으면 담고, `null`이면 그 줄이 아예 없다
- 템플릿이 있으면 제목과 본문을 담고, 비면 "참고 템플릿" 절 자체가 없다
- 과거 답변이 있으면 담고, 비면 그 절 자체가 없다
- `requestSuggestion`: 키 없으면 `{ ok: false, reason: "not_configured" }` (SDK 미호출), 정상 응답이면 `{ ok: true, text }`(trim됨), `finishReason: "SAFETY"`면 `refused`, 빈 텍스트면 `refused`, SDK가 throw하면 `failed`
- `GEMINI_MODEL`이 설정되면 그 값이 `generateContent`에 전달된다

모킹:

```ts
const generateContentMock = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(() => ({ models: { generateContent: generateContentMock } })),
}));
```

각 테스트에서 `process.env.GEMINI_API_KEY`를 설정/삭제하고 `vi.resetModules()` + 동적 `import`로 모듈을 다시 불러야 한다 — 키를 모듈 로드 시점이 아니라 호출 시점에 읽으므로 실제로는 재로딩이 필요 없지만, 환경변수를 건드리는 테스트는 `afterEach`에서 원복해야 한다.

- [ ] **Step 2: 실패 확인**

- [ ] **Step 3: 구현**

```ts
import { GoogleGenAI } from "@google/genai";

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

export type SuggestResult =
  | { ok: true; text: string }
  | { ok: false; reason: "not_configured" | "refused" | "failed" };

const SYSTEM_PROMPT = [
  "당신은 게임사 THE PLAY+의 고객지원 담당자입니다.",
  "접수된 문의에 보낼 답변 메일 본문을 한국어로 작성하세요.",
  "",
  "규칙:",
  "- 메일 본문만 출력하세요. 머리말, 설명, 따옴표, 코드블록을 붙이지 마세요.",
  "- 확인되지 않은 사실을 지어내지 마세요. 보상 지급, 환불 승인, 수정 일정처럼",
  "  확인이 필요한 사항은 약속하지 말고 '확인 후 안내드리겠습니다'로 남기세요.",
  "- 참고 템플릿이 주어지면 그 말투와 구조를 따르세요.",
  "- 과거 답변 예시가 주어지면 표현 방식을 참고하세요.",
  "- 서명이나 발신자 정보는 붙이지 마세요. 발송 시스템이 처리합니다.",
].join("\n");

export function buildSuggestPrompt(input: SuggestInput): { system: string; userMessage: string } {
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
    for (const template of input.templates) {
      lines.push("", `[${template.title}]`, template.content);
    }
  }

  if (input.pastReplies.length > 0) {
    lines.push("", "---", "같은 유형의 과거 답변 예시:");
    for (const reply of input.pastReplies) {
      lines.push("", reply);
    }
  }

  return { system: SYSTEM_PROMPT, userMessage: lines.join("\n") };
}

export async function requestSuggestion(input: SuggestInput): Promise<SuggestResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "not_configured" };
  }

  const { system, userMessage } = buildSuggestPrompt(input);

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite",
      contents: userMessage,
      config: {
        systemInstruction: system,
        maxOutputTokens: 2048,
        temperature: 0.4,
        // 답변 한 통 쓰는 데 사고가 필요 없고, 관리자가 기다리는 화면이라
        // 지연이 그대로 보인다.
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    // 안전 필터 차단은 예외가 아니라 정상 응답으로 돌아온다.
    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason === "SAFETY" || finishReason === "RECITATION") {
      return { ok: false, reason: "refused" };
    }

    const text = response.text?.trim();
    if (!text) {
      return { ok: false, reason: "refused" };
    }

    return { ok: true, text };
  } catch (error) {
    console.warn("[suggest] Gemini request failed", error);
    return { ok: false, reason: "failed" };
  }
}
```

- [ ] **Step 4: 통과 확인 · Step 5: 커밋**

---

### Task 5: 템플릿 추가·삭제 API

**Files:** Create `app/api/games/[gameId]/templates/route.ts`, `app/api/templates/[id]/route.ts`; Test `tests/api/template-create.test.ts`, `tests/api/template-delete.test.ts`

> `app/api/games/[gameId]/` 디렉터리는 이미 존재하며 사용자의 미커밋 작업(`route.ts`)이 들어 있다. **그 파일을 건드리지 말고** 하위에 `templates/route.ts`만 새로 만든다. 커밋 시 새 파일만 명시적으로 add한다.

- [ ] **Step 1~2: 테스트 작성과 실패 확인** — `tests/api/inquiry-notes.test.ts` 패턴. 검증: 401 / 400(빈 title 또는 content) / 500(저장 실패) / 성공.

- [ ] **Step 3: 구현**

`app/api/games/[gameId]/templates/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { createTemplate } from "@/lib/templates";

const templateSchema = z.object({
  typeKey: z.string().trim().min(1).nullable(),
  title: z.string().trim().min(1).max(100),
  content: z.string().trim().min(1).max(5000),
});

export async function POST(request: Request, { params }: { params: { gameId: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = templateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_template" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const saved = await createTemplate(supabase, {
    gameId: params.gameId,
    typeKey: parsed.data.typeKey,
    title: parsed.data.title,
    content: parsed.data.content,
  });

  if (!saved) {
    return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
```

`app/api/templates/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { deleteTemplate } from "@/lib/templates";

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  const deleted = await deleteTemplate(supabase, params.id);

  if (!deleted) {
    return NextResponse.json({ success: false, error: "delete_failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4~5: 통과 확인과 커밋**

---

### Task 6: 추천 API

**Files:** Create `app/api/inquiries/[id]/suggest/route.ts`, `tests/api/inquiry-suggest.test.ts`

- [ ] **Step 1~2: 테스트와 실패 확인** — 검증: 401 / 404(문의 없음) / `not_configured` 그대로 전달 / `refused` 그대로 전달 / 성공 시 `{ success: true, suggestion }`. `@/lib/suggest`, `@/lib/templates`, `@/lib/replies`, `@/lib/categories`를 모두 모킹한다.

`not_configured`와 `refused`는 500이 아니라 **각각 구분되는 에러 코드**로 내려야 화면이 다른 문구를 띄운다. HTTP 상태는 셋 다 500으로 통일한다 — 클라이언트는 `error` 필드로 분기한다.

- [ ] **Step 3: 구현**

```ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { getInquiryById } from "@/lib/inquiries";
import { listCategoryLabels, listGames } from "@/lib/categories";
import { listTemplates } from "@/lib/templates";
import { listRecentRepliesByType } from "@/lib/replies";
import { requestSuggestion } from "@/lib/suggest";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  const inquiry = await getInquiryById(supabase, params.id);
  if (!inquiry) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }

  const [labels, games, templates, pastReplies] = await Promise.all([
    listCategoryLabels(supabase, inquiry.gameId),
    listGames(supabase),
    listTemplates(supabase, inquiry.gameId),
    listRecentRepliesByType(supabase, inquiry.gameId, inquiry.typeKey),
  ]);

  const game = games.find((entry) => entry.id === inquiry.gameId);

  // 해당 유형 템플릿 + 공용 템플릿(type_key가 null)만 근거로 넘긴다.
  const relevant = templates.filter(
    (template) => template.typeKey === null || template.typeKey === inquiry.typeKey
  );

  const result = await requestSuggestion({
    gameName: game?.name ?? "",
    groupLabel: labels.groupLabels[inquiry.groupKey] ?? inquiry.groupKey,
    typeLabel: labels.typeLabels[inquiry.typeKey] ?? inquiry.typeKey,
    title: inquiry.title,
    content: inquiry.content,
    gameAccount: inquiry.gameAccount,
    companyName: inquiry.companyName,
    templates: relevant.map((template) => ({ title: template.title, content: template.content })),
    pastReplies,
  });

  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.reason }, { status: 500 });
  }

  // 추천은 이력에 남기지 않는다 (스펙 결정 4).
  return NextResponse.json({ success: true, suggestion: result.text });
}
```

- [ ] **Step 4~5: 통과 확인과 커밋**

---

### Task 7: 템플릿 관리 화면

**Files:** Create `components/templates/TemplateManager.tsx`, `app/(admin)/games/[gameId]/templates/page.tsx`, `tests/components/TemplateManager.test.tsx`

**Produces:** `<TemplateManager gameId={string} templates={TemplateRow[]} typeLabels={Record<string,string>} />`

- [ ] **Step 1~2: 테스트와 실패 확인** — 검증: 빈 상태 문구, 목록 렌더(제목·유형 라벨), 추가 요청 body와 `router.refresh()`, 제목/본문이 비면 미제출, 실패 시 에러 문구와 입력 보존, 삭제 요청 URL.

삭제는 `confirm()`을 쓰지 않는다 (브라우저 모달 금지). 삭제 버튼을 누르면 그 행에 "삭제할까요? [예] [아니오]"가 인라인으로 뜨는 2단계 확인으로 만든다.

- [ ] **Step 3: 구현** — `InquiryNotes.tsx`의 폼 패턴을 따른다. 유형 선택은 `<select>`이며 첫 옵션은 `공용 (모든 유형)` = `""` → 전송 시 `null`로 변환.

- [ ] **Step 4: 페이지**

```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase";
import { listCategoryLabels, listGames } from "@/lib/categories";
import { listTemplates } from "@/lib/templates";
import TemplateManager from "@/components/templates/TemplateManager";

export const dynamic = "force-dynamic";

export default async function TemplatesPage({ params }: { params: { gameId: string } }) {
  const supabase = getSupabaseServerClient();
  const [games, templates, labels] = await Promise.all([
    listGames(supabase),
    listTemplates(supabase, params.gameId),
    listCategoryLabels(supabase, params.gameId),
  ]);

  const game = games.find((entry) => entry.id === params.gameId);
  if (!game) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-4">
      <Link href={`/games/${params.gameId}/inquiries`} className="text-sm text-muted hover:text-ink transition-colors">
        ← 문의함
      </Link>
      <header className="flex items-center gap-3">
        <h1 className="text-xl font-bold">{game.name}</h1>
        <span className="text-sm text-muted">답변 템플릿</span>
      </header>
      <TemplateManager gameId={params.gameId} templates={templates} typeLabels={labels.typeLabels} />
    </div>
  );
}
```

- [ ] **Step 5~6: 통과 확인과 커밋**

---

### Task 8: `TemplatePicker`

**Files:** Create `components/inquiries/TemplatePicker.tsx`, `tests/components/TemplatePicker.test.tsx`

**Produces:** `<TemplatePicker templates={TemplateRow[]} typeKey={string} onPick={(content: string) => void} />`

- [ ] **Step 1~2: 테스트와 실패 확인** — 검증: 해당 유형 + 공용만 보이고 다른 유형은 안 보인다, 선택하면 `onPick`이 본문과 함께 호출된다, 쓸 템플릿이 하나도 없으면 아무것도 렌더하지 않는다.

- [ ] **Step 3: 구현**

```tsx
"use client";

import type { TemplateRow } from "@/lib/templates";

export default function TemplatePicker({
  templates,
  typeKey,
  onPick,
}: {
  templates: TemplateRow[];
  typeKey: string;
  onPick: (content: string) => void;
}) {
  // 해당 유형 템플릿 + 공용 템플릿(type_key가 null)만 고를 수 있다.
  const usable = templates.filter((t) => t.typeKey === null || t.typeKey === typeKey);

  if (usable.length === 0) {
    return null;
  }

  return (
    <select
      value=""
      aria-label="템플릿 선택"
      onChange={(e) => {
        const picked = usable.find((t) => t.id === e.target.value);
        if (picked) {
          onPick(picked.content);
        }
      }}
      className="bg-panel border border-line rounded-lg px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
    >
      <option value="">템플릿 선택</option>
      {usable.map((template) => (
        <option key={template.id} value={template.id}>
          {template.title}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 4~5: 통과 확인과 커밋**

---

### Task 9: `SuggestButton`

**Files:** Create `components/inquiries/SuggestButton.tsx`, `tests/components/SuggestButton.test.tsx`

**Produces:** `<SuggestButton inquiryId={string} onApply={(text: string) => void} />`

- [ ] **Step 1~2: 테스트와 실패 확인** — 검증: 버튼 클릭 시 POST, 로딩 중 버튼 비활성, 성공 시 미리보기에 본문 표시, `[적용]`이 `onApply` 호출 후 미리보기 닫힘, `[버리기]`가 `onApply` 없이 닫힘, `not_configured`/`refused`/`failed` 각각 다른 문구.

- [ ] **Step 3: 구현**

```tsx
"use client";

import { useState } from "react";

const ERROR_MESSAGES: Record<string, string> = {
  not_configured: "GEMINI_API_KEY가 설정되지 않았습니다.",
  refused: "안전 필터에 걸려 추천을 만들지 못했습니다.",
  not_found: "문의를 찾을 수 없습니다.",
};

export default function SuggestButton({
  inquiryId,
  onApply,
}: {
  inquiryId: string;
  onApply: (text: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSuggest() {
    setLoading(true);
    setError(null);
    setSuggestion(null);

    let json: { success: boolean; suggestion?: string; error?: string };
    try {
      const response = await fetch(`/api/inquiries/${inquiryId}/suggest`, { method: "POST" });
      json = await response.json();
    } catch {
      setLoading(false);
      setError("추천 생성에 실패했습니다.");
      return;
    }
    setLoading(false);

    if (!json.success || !json.suggestion) {
      setError(ERROR_MESSAGES[json.error ?? ""] ?? "추천 생성에 실패했습니다.");
      return;
    }

    setSuggestion(json.suggestion);
  }

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

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {suggestion && (
        <div className="border border-line rounded-lg p-3 bg-ground">
          <p className="text-xs text-muted mb-2">추천 답변 (아직 적용되지 않았습니다)</p>
          <p className="whitespace-pre-wrap text-sm">{suggestion}</p>
          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              onClick={() => {
                onApply(suggestion);
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
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4~5: 통과 확인과 커밋**

---

### Task 10: `ReplyForm` 통합과 페이지 배선

**Files:** Modify `components/inquiries/ReplyForm.tsx`, `app/(admin)/inquiries/[id]/page.tsx`, `tests/components/ReplyForm.test.tsx`

**Produces:** `<ReplyForm inquiryId initialDraft templates typeKey />`

- [ ] **Step 1: 테스트 수정** — 기존 6개 테스트에 `templates={[]} typeKey="bug_report"` 추가. 신규 검증:
  - 답변란이 비어 있을 때 템플릿을 고르면 그대로 채워진다
  - 답변란에 내용이 있을 때 템플릿을 고르면 **대체되지 않고** "작성 중인 내용을 대체합니다. 한 번 더 선택하면 대체됩니다." 경고가 뜬다
  - 경고 상태에서 같은 템플릿을 다시 고르면 대체된다
  - 템플릿이 없으면 선택 UI가 렌더되지 않는다

- [ ] **Step 2: 실패 확인**

- [ ] **Step 3: 구현** — `ReplyForm`에 다음을 더한다.

```tsx
  const [pendingReplace, setPendingReplace] = useState<string | null>(null);

  // 템플릿 삽입과 추천 적용은 작성 중인 글을 말없이 덮어쓰지 않는다.
  // 비어 있으면 그냥 넣고, 내용이 있으면 한 번 경고한 뒤 두 번째에 대체한다.
  // 브라우저 confirm()은 쓰지 않는다 — 확장 세션을 멈추게 하고 UX도 나쁘다.
  function applyText(next: string) {
    if (replyContent.trim() === "" || pendingReplace === next) {
      setReplyContent(next);
      setPendingReplace(null);
      setMessage(null);
      return;
    }
    setPendingReplace(next);
    setMessage("작성 중인 내용을 대체합니다. 한 번 더 선택하면 대체됩니다.");
  }
```

버튼 줄 위에 다음을 넣는다:

```tsx
      <div className="flex flex-wrap items-center gap-2">
        <TemplatePicker templates={templates} typeKey={typeKey} onPick={applyText} />
        <SuggestButton inquiryId={inquiryId} onApply={applyText} />
      </div>
```

`SuggestButton`이 세로로 펼쳐지므로 이 줄은 `items-start`가 자연스럽다 — 렌더 후 확인해 조정한다.

- [ ] **Step 4: 상세 페이지 배선** — `app/(admin)/inquiries/[id]/page.tsx`에서 `listTemplates`를 `Promise.all`에 추가하고 `<ReplyForm ... templates={templates} typeKey={inquiry.typeKey} />`로 넘긴다.

- [ ] **Step 5: 전체 검증** `npx tsc --noEmit && npx vitest run && npx next build`

- [ ] **Step 6: 커밋** — 파일을 하나씩 명시적으로 add한다.

---

## 완료 후 보고 항목

- `npx tsc --noEmit` / `npx vitest run` / `npx next build` 결과
- **깨끗한 체크아웃에서도 테스트가 통과하는지** (`git worktree`로 확인) — 2단계에서 미커밋 작업이 섞여 들어간 사고가 있었다
- `supabase/migrations/0004_reply_templates.sql`은 사람이 적용해야 한다
- `.env`에 `GEMINI_API_KEY`가 없으면 추천 버튼만 실패한다
- **모델 ID `gemini-2.5-flash-lite`는 실제 호출로 검증되지 않았다** — 키가 없어 확인할 수 없었고, 틀리면 첫 호출에서 드러나며 `GEMINI_MODEL`로 교체 가능
- 템플릿 관리 페이지 진입 링크는 범위 밖이다 (미커밋 작업 충돌 회피)
