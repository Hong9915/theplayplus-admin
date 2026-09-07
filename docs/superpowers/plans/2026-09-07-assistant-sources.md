# 운영 어시스턴트 자료 연결(시트·문서 여러 개) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 게임마다 구글 스프레드시트와 구글 문서를 여러 개 연결해 어시스턴트가 모두 근거로 쓰고, 사이드바에서 그 목록을 보고 추가·삭제한다.

**Architecture:** `games.sheet_id` 하나를 `assistant_sources` 표(kind sheet|doc)로 바꾼다. 자료 읽기는 `lib/assistant-sources.ts`가 시트(`lib/sheets.ts`)와 문서(`lib/docs.ts`)를 병렬로 읽어 `# 시트: 제목` / `# 문서: 제목` 구간으로 직렬화한다. 수정 제안은 도구 인자 `spreadsheet`(시트 제목)로 자료를 골라 `sourceId`를 붙여 저장하고, 적용 시 그 자료의 시트에 쓴다.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase, `googleapis`(Sheets v4 + Docs v1), `openai`, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-07-assistant-sources-design.md`

## Global Constraints

- 관리자 UI 문구는 한국어 전용.
- 자료 합계 글자 수 상한은 `MAX_SHEET_CHARS = 300_000`(기존 상수 유지).
- 오류 사유 이름: `source_forbidden`, `source_not_found`, `sources_too_large`, `source_read_failed`(기존 `sheet_*` 읽기 사유를 이 이름으로 바꾼다). `sheet_write_failed`, `invalid_proposal`, `conflict`, `not_configured`는 그대로.
- 문서는 읽기 전용. 제안 도구는 시트에만 붙는다.
- 마이그레이션 번호는 **0017**(0016은 다른 세션이 첨부 파일용으로 이미 썼다).
- 이 워크트리에는 첨부 파일 기능을 작업하는 다른 세션이 있다. 각 작업 시작 전에 `git status`·`git log -3`으로 최신 상태를 확인하고, 미커밋 변경이 있는 파일(특히 `app/api/assistant/conversations/[id]/messages/route.ts`, `tests/api/assistant-messages.test.ts`, `components/assistant/ChatPane.tsx`)은 현재 내용을 다시 읽은 뒤 고친다. 커밋할 때는 이 계획의 파일만 `git add`한다.
- 테스트 실행: `npx vitest run <경로>`. 전체는 `npx vitest run`. 타입 검사는 `npx tsc --noEmit`.
- 커밋 메시지 끝에 붙인다:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_012NxdwZEQRw3WsGLD3Gknys
  ```

---

## 파일 구조

| 파일 | 역할 |
|---|---|
| `supabase/migrations/0017_assistant_sources.sql` (신규) | `assistant_sources` 표, `games.sheet_id` 이전·삭제 |
| `lib/google-auth.ts` (신규) | 서비스 계정 JSON 로드, JWT 생성(Sheets + Docs 읽기 스코프) |
| `lib/sheets.ts` (수정) | 인증을 `google-auth`로 옮김, 읽기 사유 이름 변경, `readSpreadsheetTitle`, `SheetProposal`/`Proposal` 분리, `SheetError.sourceTitle` |
| `lib/docs.ts` (신규) | 구글 문서 본문 텍스트화(`serializeDocument`), 읽기(`readDocument`) |
| `lib/assistant-sources.ts` (신규) | 자료 저장소(CRUD), URL 파싱, 병렬 읽기(`loadSources`), 직렬화(`serializeSources`), 자료 URL |
| `lib/assistant.ts` (수정) | 프롬프트 문구, 도구 `spreadsheet` 인자, 자료 선택 후 제안에 `sourceId` 부착 |
| `lib/categories.ts` (수정) | `GameRow.sheetId` 제거 |
| `app/api/games/[gameId]/sources/route.ts` (신규) | POST 자료 등록 |
| `app/api/games/[gameId]/sources/[sourceId]/route.ts` (신규) | DELETE 자료 해제 |
| `app/api/games/[gameId]/route.ts` (수정) | PATCH 제거 |
| `app/api/assistant/conversations/[id]/messages/route.ts` (수정) | 자료 목록 읽기·직렬화 |
| `app/api/assistant/messages/[id]/apply/route.ts` (수정) | `sourceId`로 시트 선택 |
| `app/(assistant)/games/[gameId]/assistant/page.tsx` (수정) | 자료 목록 조회 |
| `components/assistant/ConversationSidebar.tsx` (수정) | 연결된 자료 목록 |
| `components/assistant/SourceAddDialog.tsx` (신규, `SheetSettingsDialog.tsx` 삭제) | 자료 추가 |
| `components/assistant/AssistantShell.tsx`, `ProposalCard.tsx`, `ChatPane.tsx`, `messages.ts` (수정) | props·문구 |
| `CLAUDE.md`, `.env.example` (수정) | 설명·설정 절차 |

---

### Task 1: 마이그레이션과 자료 저장소

**Files:**
- Create: `supabase/migrations/0017_assistant_sources.sql`
- Create: `lib/assistant-sources.ts`
- Test: `tests/lib/assistant-sources.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SourceKind = "sheet" | "doc";
  export interface SourceRow { id: string; gameId: string; kind: SourceKind; externalId: string; title: string; createdAt: string }
  export function parseSourceUrl(input: string): { kind: SourceKind; externalId: string } | null
  export function sourceUrl(source: Pick<SourceRow, "kind" | "externalId">): string
  export async function listSources(supabase, gameId: string): Promise<SourceRow[]>
  export async function getSource(supabase, id: string): Promise<SourceRow | null>
  export async function insertSource(supabase, input: { gameId; kind; externalId; title }): Promise<SourceRow | null | "duplicate">
  export async function deleteSource(supabase, gameId: string, id: string): Promise<boolean>
  ```

- [ ] **Step 1: 마이그레이션 작성**

`supabase/migrations/0017_assistant_sources.sql`:

```sql
-- 운영 어시스턴트 자료 연결: 게임마다 구글 시트·문서를 여러 개 붙인다. games.sheet_id를 대체한다.

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

-- 관리자 앱은 service role로 접근한다. anon(접수 폼)은 볼 이유가 없다.
alter table assistant_sources enable row level security;

-- 기존 시트 연결을 옮긴다. 실제 제목은 모르므로 '운영 시트'로 두고, 화면에서 해제 후 다시 등록하면 실제 제목이 들어간다.
insert into assistant_sources (game_id, kind, external_id, title)
select id, 'sheet', sheet_id, '운영 시트' from games where sheet_id is not null
on conflict do nothing;

alter table games drop column if exists sheet_id;
```

- [ ] **Step 2: 실패하는 테스트 작성**

`tests/lib/assistant-sources.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { parseSourceUrl, sourceUrl, listSources, getSource, insertSource, deleteSource } from "@/lib/assistant-sources";

const row = { id: "s1", game_id: "g1", kind: "sheet", external_id: "1AbC-_9", title: "VIP 원장", created_at: "2026-09-07T00:00:00.000Z" };
const mapped = { id: "s1", gameId: "g1", kind: "sheet", externalId: "1AbC-_9", title: "VIP 원장", createdAt: "2026-09-07T00:00:00.000Z" };

describe("parseSourceUrl", () => {
  it("detects a spreadsheet url", () => {
    expect(parseSourceUrl("https://docs.google.com/spreadsheets/d/1AbC-_9/edit#gid=0")).toEqual({ kind: "sheet", externalId: "1AbC-_9" });
  });
  it("detects a document url", () => {
    expect(parseSourceUrl(" https://docs.google.com/document/d/1DoC_x/edit ")).toEqual({ kind: "doc", externalId: "1DoC_x" });
  });
  it("rejects bare ids, other urls, and empty input", () => {
    expect(parseSourceUrl("1AbC-_9")).toBeNull();
    expect(parseSourceUrl("https://example.com/spreadsheets/d/1AbC")).toBeNull();
    expect(parseSourceUrl("")).toBeNull();
  });
});

describe("sourceUrl", () => {
  it("builds the edit url per kind", () => {
    expect(sourceUrl({ kind: "sheet", externalId: "1AbC" })).toBe("https://docs.google.com/spreadsheets/d/1AbC/edit");
    expect(sourceUrl({ kind: "doc", externalId: "1DoC" })).toBe("https://docs.google.com/document/d/1DoC/edit");
  });
});

describe("store", () => {
  it("listSources orders by created_at and maps rows", async () => {
    const order = vi.fn().mockResolvedValue({ data: [row], error: null });
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const supabase = { from: vi.fn(() => ({ select })) } as never;

    expect(await listSources(supabase, "g1")).toEqual([mapped]);
    expect(eq).toHaveBeenCalledWith("game_id", "g1");
    expect(order).toHaveBeenCalledWith("created_at", { ascending: true });
  });

  it("getSource returns null when missing", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const supabase = { from: vi.fn(() => ({ select })) } as never;
    expect(await getSource(supabase, "s1")).toBeNull();
  });

  it("insertSource returns the row, or 'duplicate' on a unique violation", async () => {
    const single = vi.fn().mockResolvedValueOnce({ data: row, error: null }).mockResolvedValueOnce({ data: null, error: { code: "23505" } });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const supabase = { from: vi.fn(() => ({ insert })) } as never;
    const input = { gameId: "g1", kind: "sheet" as const, externalId: "1AbC-_9", title: "VIP 원장" };

    expect(await insertSource(supabase, input)).toEqual(mapped);
    expect(insert).toHaveBeenCalledWith({ game_id: "g1", kind: "sheet", external_id: "1AbC-_9", title: "VIP 원장" });
    expect(await insertSource(supabase, input)).toBe("duplicate");
  });

  it("deleteSource scopes the delete to the game and reports whether a row went away", async () => {
    const select = vi.fn().mockResolvedValue({ data: [{ id: "s1" }], error: null });
    const eq2 = vi.fn(() => ({ select }));
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const del = vi.fn(() => ({ eq: eq1 }));
    const supabase = { from: vi.fn(() => ({ delete: del })) } as never;

    expect(await deleteSource(supabase, "g1", "s1")).toBe(true);
    expect(eq1).toHaveBeenCalledWith("id", "s1");
    expect(eq2).toHaveBeenCalledWith("game_id", "g1");

    select.mockResolvedValue({ data: [], error: null });
    expect(await deleteSource(supabase, "g1", "s1")).toBe(false);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run tests/lib/assistant-sources.test.ts`
Expected: FAIL — `Cannot find module '@/lib/assistant-sources'`

- [ ] **Step 4: 구현**

`lib/assistant-sources.ts`:

```ts
/**
 * 운영 어시스턴트가 근거로 쓰는 자료(구글 시트·문서). 게임마다 여러 개.
 * 이 파일은 저장소와 URL 규칙만 다룬다. 읽기·직렬화는 Task 4에서 이 파일에 덧붙인다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type SourceKind = "sheet" | "doc";

export interface SourceRow {
  id: string;
  gameId: string;
  kind: SourceKind;
  externalId: string;
  title: string;
  createdAt: string;
}

/** 종류는 URL 경로로만 판별한다. ID만 오면 시트인지 문서인지 알 수 없어 null. */
export function parseSourceUrl(input: string): { kind: SourceKind; externalId: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^https:\/\/docs\.google\.com\/(spreadsheets|document)\/d\/([A-Za-z0-9_-]+)/);
  if (!match) return null;
  return { kind: match[1] === "spreadsheets" ? "sheet" : "doc", externalId: match[2] };
}

export function sourceUrl(source: Pick<SourceRow, "kind" | "externalId">): string {
  const segment = source.kind === "sheet" ? "spreadsheets" : "document";
  return `https://docs.google.com/${segment}/d/${source.externalId}/edit`;
}

function mapSource(row: { id: string; game_id: string; kind: string; external_id: string; title: string; created_at: string }): SourceRow {
  return { id: row.id, gameId: row.game_id, kind: row.kind as SourceKind, externalId: row.external_id, title: row.title, createdAt: row.created_at };
}

export async function listSources(supabase: SupabaseClient, gameId: string): Promise<SourceRow[]> {
  const { data, error } = await supabase.from("assistant_sources").select("*").eq("game_id", gameId).order("created_at", { ascending: true });
  if (error) throw new Error(`Failed to list sources: ${error.message}`);
  return (data ?? []).map(mapSource);
}

export async function getSource(supabase: SupabaseClient, id: string): Promise<SourceRow | null> {
  const { data, error } = await supabase.from("assistant_sources").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return mapSource(data);
}

export async function insertSource(
  supabase: SupabaseClient,
  input: { gameId: string; kind: SourceKind; externalId: string; title: string }
): Promise<SourceRow | null | "duplicate"> {
  const { data, error } = await supabase
    .from("assistant_sources")
    .insert({ game_id: input.gameId, kind: input.kind, external_id: input.externalId, title: input.title })
    .select("*")
    .single();
  if (error?.code === "23505") return "duplicate";
  if (error || !data) return null;
  return mapSource(data);
}

/** 그 게임의 자료만 지운다. 지워진 행이 없으면 false. */
export async function deleteSource(supabase: SupabaseClient, gameId: string, id: string): Promise<boolean> {
  const { data, error } = await supabase.from("assistant_sources").delete().eq("id", id).eq("game_id", gameId).select("id");
  if (error) return false;
  return (data ?? []).length > 0;
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/lib/assistant-sources.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 6: 커밋**

```bash
git add supabase/migrations/0017_assistant_sources.sql lib/assistant-sources.ts tests/lib/assistant-sources.test.ts
git commit -m "feat: assistant_sources table and store for linking sheets and docs"
```

---

### Task 2: 구글 인증 분리, 시트 제목 읽기, 사유 이름 변경

**Files:**
- Create: `lib/google-auth.ts`
- Modify: `lib/sheets.ts`
- Modify: `tests/lib/sheets.test.ts`
- Modify: `components/assistant/messages.ts` (사유 키만)

**Interfaces:**
- Produces:
  ```ts
  // lib/google-auth.ts
  export function loadServiceAccount(): { client_email: string; private_key: string } | null
  export function serviceAccountEmail(): string | null
  export function googleAuth(): JWT   // 없으면 throw new SheetError("not_configured")
  // lib/sheets.ts
  export type SheetErrorReason = "not_configured" | "source_forbidden" | "source_not_found" | "sources_too_large" | "source_read_failed" | "sheet_write_failed" | "invalid_proposal" | "conflict"
  export class SheetError extends Error { reason: SheetErrorReason; sourceTitle?: string }
  export type SheetProposal = | { kind: "update"; sheet; row; updates } | { kind: "append"; sheet; values }
  export type Proposal = SheetProposal & { sourceId: string; sourceTitle: string }
  export function readSpreadsheetTitle(sheetId: string): Promise<string>
  export function serviceAccountEmail(): string | null   // google-auth 재수출
  ```
- `prepareProposal`은 `SheetProposal | null`을, `validateProposal`·`applyProposal`은 `SheetProposal`을 받는다(`Proposal`도 그대로 넘길 수 있다).

- [ ] **Step 1: 실패하는 테스트 추가·수정**

`tests/lib/sheets.test.ts`에서:

1. `readSpreadsheet` describe 안의 사유 기대값을 바꾼다: `sheet_forbidden` → `source_forbidden`, `sheet_not_found` → `source_not_found`, `sheet_read_failed` → `source_read_failed`, `sheet_too_large` → `sources_too_large`. 테스트 이름 "throws sheet_too_large past the cap"도 "throws sources_too_large past the cap"으로.
2. import 목록에 `readSpreadsheetTitle`을 추가하고 `readSpreadsheet` describe 뒤에 추가:

```ts
describe("readSpreadsheetTitle", () => {
  beforeEach(() => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = CREDS;
    getMock.mockReset();
  });
  afterEach(() => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  });

  it("asks only for the title", async () => {
    getMock.mockResolvedValue({ data: { properties: { title: "VIP 원장" } } });
    expect(await readSpreadsheetTitle("s1")).toBe("VIP 원장");
    expect(getMock).toHaveBeenCalledWith({ spreadsheetId: "s1", fields: "properties.title" });
  });

  it("falls back to the id when the title is empty and maps failures", async () => {
    getMock.mockResolvedValue({ data: { properties: {} } });
    expect(await readSpreadsheetTitle("s1")).toBe("s1");
    getMock.mockRejectedValueOnce({ code: 403 });
    await expect(readSpreadsheetTitle("s1")).rejects.toMatchObject({ reason: "source_forbidden" });
  });
});

describe("SheetError", () => {
  it("carries an optional source title", () => {
    const error = new SheetError("source_forbidden");
    expect(error.sourceTitle).toBeUndefined();
    error.sourceTitle = "VIP 원장";
    expect(error.sourceTitle).toBe("VIP 원장");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/lib/sheets.test.ts`
Expected: FAIL — `readSpreadsheetTitle is not a function`, 사유 이름 불일치

- [ ] **Step 3: `lib/google-auth.ts` 작성**

```ts
/**
 * 운영 어시스턴트가 구글 시트·문서를 읽는 서비스 계정. 시트 쓰기와 문서 읽기 스코프를
 * 한 JWT에 담아 lib/sheets.ts와 lib/docs.ts가 같이 쓴다.
 */
import { google } from "googleapis";
import { SheetError } from "@/lib/sheets";

export interface ServiceAccount {
  client_email: string;
  private_key: string;
}

export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/documents.readonly"];

export function loadServiceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    if (typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") return null;
    return { client_email: parsed.client_email, private_key: parsed.private_key };
  } catch {
    return null;
  }
}

/** 설정 안내용. 관리자가 이 주소에 자료를 공유해야 한다. */
export function serviceAccountEmail(): string | null {
  return loadServiceAccount()?.client_email ?? null;
}

export function googleAuth() {
  const account = loadServiceAccount();
  if (!account) throw new SheetError("not_configured");
  return new google.auth.JWT({ email: account.client_email, key: account.private_key, scopes: GOOGLE_SCOPES });
}
```

주의: `lib/sheets.ts`와 순환 import가 된다(`SheetError`). `SheetError`는 클래스 선언이라 모듈 평가 시점에 쓰지 않고 함수 안에서만 쓰므로 ESM에서 문제없다. 그래도 피하려면 `SheetError`를 `lib/google-auth.ts`로 옮기고 `lib/sheets.ts`가 재수출해도 된다. 여기서는 **`SheetError`와 `SheetErrorReason`을 `lib/google-auth.ts`에 정의하고 `lib/sheets.ts`가 재수출**하는 쪽을 택한다(아래 Step 4 참고).

- [ ] **Step 4: `lib/sheets.ts` 수정**

파일 상단 타입·클래스·인증 부분을 다음으로 바꾼다:

```ts
import { google, type sheets_v4 } from "googleapis";
import { googleAuth, serviceAccountEmail, SheetError, type SheetErrorReason } from "@/lib/google-auth";

export { SheetError, serviceAccountEmail, type SheetErrorReason };

/** rows[i]는 시트의 i+1행. 헤더가 있으면 rows[0]이 헤더다. */
export interface SheetTab {
  title: string;
  header: string[] | null;
  rows: string[][];
}

export type ProposalUpdate = { column: string; before: string; after: string };

/** 한 스프레드시트 안에서의 수정 내용. 어느 스프레드시트인지는 Proposal이 붙인다. */
export type SheetProposal =
  | { kind: "update"; sheet: string; row: number; updates: ProposalUpdate[] }
  | { kind: "append"; sheet: string; values: Record<string, string> };

/** 저장·적용되는 제안. sourceId는 assistant_sources.id, sourceTitle은 표시용. */
export type Proposal = SheetProposal & { sourceId: string; sourceTitle: string };
```

`lib/google-auth.ts`의 맨 위(import 아래)에 옮겨 넣는다:

```ts
export type SheetErrorReason =
  | "not_configured"
  | "source_forbidden"
  | "source_not_found"
  | "sources_too_large"
  | "source_read_failed"
  | "sheet_write_failed"
  | "invalid_proposal"
  | "conflict";

export class SheetError extends Error {
  /** 어느 자료에서 났는지. loadSources가 채운다. */
  sourceTitle?: string;
  constructor(
    public readonly reason: SheetErrorReason,
    message?: string
  ) {
    super(message ?? reason);
    this.name = "SheetError";
  }
}
```

그리고 `lib/google-auth.ts`에서 `import { SheetError } from "@/lib/sheets"` 줄을 지운다.

`lib/sheets.ts`에서:
- `prepareProposal`의 반환 타입을 `SheetProposal | null`로, `validateProposal(tabs, proposal: SheetProposal)`, `applyProposal(sheetId, proposal: SheetProposal)`로 바꾼다.
- `interface ServiceAccount`, `loadServiceAccount`, `serviceAccountEmail` 정의를 지운다(google-auth로 옮겼다).
- `sheetsClient()`를 다음으로:

```ts
function sheetsClient(): sheets_v4.Sheets {
  return google.sheets({ version: "v4", auth: googleAuth() });
}
```

- `readSpreadsheet`의 catch 매핑을 바꾼다: `403 → "source_forbidden"`, `404 → "source_not_found"`, 그 외 `"source_read_failed"`, 상한 초과는 `"sources_too_large"`.
- `readSpreadsheet` 위에 추가:

```ts
/** 등록 시 저장할 제목. 제목이 비어 있으면 ID를 쓴다. */
export async function readSpreadsheetTitle(sheetId: string): Promise<string> {
  const sheets = sheetsClient();
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: "properties.title" });
    const title = meta.data.properties?.title?.trim();
    return title || sheetId;
  } catch (error) {
    throw mapReadError(error);
  }
}

function mapReadError(error: unknown): SheetError {
  if (error instanceof SheetError) return error;
  const status = statusOf(error);
  if (status === 403) return new SheetError("source_forbidden");
  if (status === 404) return new SheetError("source_not_found");
  console.warn("[sheets] read failed", error);
  return new SheetError("source_read_failed");
}
```

`readSpreadsheet`의 catch도 `throw mapReadError(error)` 한 줄로 바꾼다(`statusOf`는 `mapReadError`보다 위에 있어야 하므로 위치를 맞춘다. 함수 선언은 호이스팅되니 순서는 실제로 상관없다).

- [ ] **Step 5: `components/assistant/messages.ts` 사유 키 변경**

`STREAM_ERROR_MESSAGES`의 키 `sheet_forbidden`·`sheet_not_found`·`sheet_too_large`·`sheet_read_failed`를 `source_forbidden`·`source_not_found`·`sources_too_large`·`source_read_failed`로 바꾼다(문구는 Task 8에서 다시 손본다). `APPLY_FAILURE_MESSAGES`의 `sheet_forbidden`도 `source_forbidden`으로.

- [ ] **Step 6: 통과 확인**

Run: `npx vitest run tests/lib/sheets.test.ts && npx tsc --noEmit`
Expected: sheets 테스트 PASS. tsc는 `Proposal`에 `sourceId`가 없다는 오류가 `lib/assistant.ts`·라우트·테스트에서 날 수 있다. 그 오류는 Task 5·7에서 없어지므로 여기서는 sheets 관련 오류만 없으면 된다.

- [ ] **Step 7: 커밋**

```bash
git add lib/google-auth.ts lib/sheets.ts tests/lib/sheets.test.ts components/assistant/messages.ts
git commit -m "refactor: share Google auth, generalize source read errors, add readSpreadsheetTitle"
```

---

### Task 3: 구글 문서 읽기

**Files:**
- Create: `lib/docs.ts`
- Test: `tests/lib/docs.test.ts`

**Interfaces:**
- Consumes: `googleAuth`, `SheetError` from `@/lib/google-auth`
- Produces:
  ```ts
  export function serializeDocument(document: docs_v1.Schema$Document): string
  export async function readDocument(docId: string): Promise<{ title: string; text: string }>
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/lib/docs.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { serializeDocument, readDocument } from "@/lib/docs";

const getMock = vi.fn();
vi.mock("googleapis", () => ({
  google: {
    auth: { JWT: vi.fn(function () { return {}; }) },
    docs: vi.fn(() => ({ documents: { get: getMock } })),
  },
}));

const CREDS = JSON.stringify({ client_email: "bot@proj.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n" });

function paragraph(text: string, extra: Record<string, unknown> = {}) {
  return { paragraph: { elements: [{ textRun: { content: text } }], ...extra } };
}

describe("serializeDocument", () => {
  it("joins paragraphs, marks headings and bullets, skips empty ones", () => {
    const text = serializeDocument({
      body: {
        content: [
          { sectionBreak: {} },
          paragraph("환불 정책\n", { paragraphStyle: { namedStyleType: "HEADING_1" } }),
          paragraph("\n"),
          paragraph("7일 이내 ", {}),
          { paragraph: { elements: [{ textRun: { content: "첫 결제만 " } }, { textRun: { content: "환불\n" } }], bullet: { listId: "l1" } } },
          paragraph("세부\n", { paragraphStyle: { namedStyleType: "HEADING_3" } }),
        ],
      },
    });
    expect(text).toBe("# 환불 정책\n7일 이내\n- 첫 결제만 환불\n### 세부");
  });

  it("renders tables as pipe rows and flattens cell newlines", () => {
    const text = serializeDocument({
      body: {
        content: [
          {
            table: {
              tableRows: [
                { tableCells: [{ content: [paragraph("코드\n")] }, { content: [paragraph("상태\n")] }] },
                { tableCells: [{ content: [paragraph("m6fu5sj\n")] }, { content: [paragraph("사용\n"), paragraph("09.01\n")] }] },
              ],
            },
          },
        ],
      },
    });
    expect(text).toBe("코드 | 상태\nm6fu5sj | 사용 09.01");
  });

  it("returns an empty string for a document without a body", () => {
    expect(serializeDocument({})).toBe("");
  });
});

describe("readDocument", () => {
  beforeEach(() => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = CREDS;
    getMock.mockReset();
  });
  afterEach(() => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  });

  it("throws not_configured without credentials", async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    await expect(readDocument("d1")).rejects.toMatchObject({ reason: "not_configured" });
  });

  it("returns the title and serialized text", async () => {
    getMock.mockResolvedValue({ data: { title: "운영 가이드", body: { content: [paragraph("안녕\n")] } } });
    expect(await readDocument("d1")).toEqual({ title: "운영 가이드", text: "안녕" });
    expect(getMock).toHaveBeenCalledWith({ documentId: "d1" });
  });

  it("falls back to the id as title and maps 403/404/other", async () => {
    getMock.mockResolvedValue({ data: { body: { content: [] } } });
    expect((await readDocument("d1")).title).toBe("d1");
    getMock.mockRejectedValueOnce({ code: 403 });
    await expect(readDocument("d1")).rejects.toMatchObject({ reason: "source_forbidden" });
    getMock.mockRejectedValueOnce({ code: 404 });
    await expect(readDocument("d1")).rejects.toMatchObject({ reason: "source_not_found" });
    getMock.mockRejectedValueOnce(new Error("boom"));
    await expect(readDocument("d1")).rejects.toMatchObject({ reason: "source_read_failed" });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/lib/docs.test.ts`
Expected: FAIL — `Cannot find module '@/lib/docs'`

- [ ] **Step 3: 구현**

`lib/docs.ts`:

```ts
/**
 * 운영 어시스턴트의 구글 문서 읽기(읽기 전용). 본문을 문단·표 단위의 텍스트로 만든다.
 */
import { google, type docs_v1 } from "googleapis";
import { googleAuth, SheetError } from "@/lib/google-auth";

const HEADING_PREFIX: Record<string, string> = {
  HEADING_1: "# ",
  HEADING_2: "## ",
  HEADING_3: "### ",
};

function paragraphText(paragraph: docs_v1.Schema$Paragraph): string {
  return (paragraph.elements ?? [])
    .map((element) => element.textRun?.content ?? "")
    .join("")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function paragraphLine(paragraph: docs_v1.Schema$Paragraph): string | null {
  const text = paragraphText(paragraph);
  if (!text) return null;
  const heading = HEADING_PREFIX[paragraph.paragraphStyle?.namedStyleType ?? ""] ?? "";
  if (heading) return `${heading}${text}`;
  if (paragraph.bullet) return `- ${text}`;
  return text;
}

function cellText(cell: docs_v1.Schema$TableCell): string {
  return (cell.content ?? [])
    .map((element) => (element.paragraph ? paragraphText(element.paragraph) : ""))
    .filter(Boolean)
    .join(" ")
    .replace(/\|/g, " ");
}

/** 문단은 줄로, 표는 `|` 행으로. 구역 구분·목차·그림은 건너뛴다. */
export function serializeDocument(document: docs_v1.Schema$Document): string {
  const lines: string[] = [];
  for (const element of document.body?.content ?? []) {
    if (element.paragraph) {
      const line = paragraphLine(element.paragraph);
      if (line) lines.push(line);
    } else if (element.table) {
      for (const row of element.table.tableRows ?? []) {
        const cells = (row.tableCells ?? []).map(cellText);
        if (cells.some(Boolean)) lines.push(cells.join(" | "));
      }
    }
  }
  return lines.join("\n");
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { code, status } = error as { code?: unknown; status?: unknown };
  if (typeof code === "number") return code;
  if (typeof status === "number") return status;
  return undefined;
}

export async function readDocument(docId: string): Promise<{ title: string; text: string }> {
  const docs = google.docs({ version: "v1", auth: googleAuth() });
  try {
    const response = await docs.documents.get({ documentId: docId });
    const title = response.data.title?.trim() || docId;
    return { title, text: serializeDocument(response.data) };
  } catch (error) {
    if (error instanceof SheetError) throw error;
    const status = statusOf(error);
    if (status === 403) throw new SheetError("source_forbidden");
    if (status === 404) throw new SheetError("source_not_found");
    console.warn("[docs] read failed", error);
    throw new SheetError("source_read_failed");
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/lib/docs.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add lib/docs.ts tests/lib/docs.test.ts
git commit -m "feat: read Google Docs into text for the assistant"
```

---

### Task 4: 자료 병렬 읽기와 직렬화

**Files:**
- Modify: `lib/assistant-sources.ts`
- Modify: `tests/lib/assistant-sources.test.ts`

**Interfaces:**
- Consumes: `readSpreadsheet`, `serializeSheets`, `MAX_SHEET_CHARS`, `SheetError`, `SheetTab` from `@/lib/sheets`; `readDocument` from `@/lib/docs`
- Produces:
  ```ts
  export type LoadedSource =
    | { source: SourceRow; kind: "sheet"; tabs: SheetTab[] }
    | { source: SourceRow; kind: "doc"; text: string };
  export async function loadSources(sources: SourceRow[]): Promise<LoadedSource[]>
  export function serializeSources(loaded: LoadedSource[]): string
  ```

- [ ] **Step 1: 실패하는 테스트 추가**

`tests/lib/assistant-sources.test.ts` 상단 import에 `loadSources`, `serializeSources`, `type LoadedSource`를 더하고, mock을 추가한다:

```ts
import * as sheetsModule from "@/lib/sheets";
import * as docsModule from "@/lib/docs";

vi.mock("@/lib/sheets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sheets")>();
  return { ...actual, readSpreadsheet: vi.fn() };
});
vi.mock("@/lib/docs", () => ({ readDocument: vi.fn() }));
```

파일 끝에 추가:

```ts
const sheetSource = { id: "s1", gameId: "g1", kind: "sheet" as const, externalId: "sh1", title: "VIP 원장", createdAt: "" };
const docSource = { id: "s2", gameId: "g1", kind: "doc" as const, externalId: "dc1", title: "운영 가이드", createdAt: "" };
const tabs = [{ title: "VIP", header: ["이메일", "VIP 단계"], rows: [["이메일", "VIP 단계"], ["a@x.com", "VIP3"]] }];

describe("loadSources", () => {
  beforeEach(() => {
    vi.mocked(sheetsModule.readSpreadsheet).mockReset().mockResolvedValue(tabs);
    vi.mocked(docsModule.readDocument).mockReset().mockResolvedValue({ title: "운영 가이드", text: "환불은 7일" });
  });

  it("reads every source in parallel and keeps their order", async () => {
    const loaded = await loadSources([sheetSource, docSource]);
    expect(loaded).toEqual([
      { source: sheetSource, kind: "sheet", tabs },
      { source: docSource, kind: "doc", text: "환불은 7일" },
    ]);
    expect(sheetsModule.readSpreadsheet).toHaveBeenCalledWith("sh1");
    expect(docsModule.readDocument).toHaveBeenCalledWith("dc1");
  });

  it("tags a failure with the source title", async () => {
    vi.mocked(docsModule.readDocument).mockRejectedValue(new sheetsModule.SheetError("source_forbidden"));
    await expect(loadSources([sheetSource, docSource])).rejects.toMatchObject({ reason: "source_forbidden", sourceTitle: "운영 가이드" });
  });

  it("throws sources_too_large when the combined text passes the cap", async () => {
    vi.mocked(docsModule.readDocument).mockResolvedValue({ title: "운영 가이드", text: "x".repeat(sheetsModule.MAX_SHEET_CHARS) });
    await expect(loadSources([sheetSource, docSource])).rejects.toMatchObject({ reason: "sources_too_large" });
  });
});

describe("serializeSources", () => {
  it("wraps each source in a titled section", () => {
    const loaded: LoadedSource[] = [
      { source: sheetSource, kind: "sheet", tabs },
      { source: docSource, kind: "doc", text: "환불은 7일" },
    ];
    expect(serializeSources(loaded)).toBe(
      ["# 시트: VIP 원장", "", "## VIP", "행 | 이메일 | VIP 단계", "2 | a@x.com | VIP3", "", "", "# 문서: 운영 가이드", "", "환불은 7일"].join("\n")
    );
  });
});
```

`beforeEach`를 import에 추가한다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/lib/assistant-sources.test.ts`
Expected: FAIL — `loadSources is not a function`

- [ ] **Step 3: 구현**

`lib/assistant-sources.ts` 상단 import에 추가하고 파일 끝에 덧붙인다:

```ts
import { MAX_SHEET_CHARS, readSpreadsheet, serializeSheets, SheetError, type SheetTab } from "@/lib/sheets";
import { readDocument } from "@/lib/docs";

export type LoadedSource =
  | { source: SourceRow; kind: "sheet"; tabs: SheetTab[] }
  | { source: SourceRow; kind: "doc"; text: string };

async function loadOne(source: SourceRow): Promise<LoadedSource> {
  try {
    if (source.kind === "sheet") {
      return { source, kind: "sheet", tabs: await readSpreadsheet(source.externalId) };
    }
    const { text } = await readDocument(source.externalId);
    return { source, kind: "doc", text };
  } catch (error) {
    if (error instanceof SheetError) {
      error.sourceTitle = source.title;
      throw error;
    }
    const wrapped = new SheetError("source_read_failed");
    wrapped.sourceTitle = source.title;
    throw wrapped;
  }
}

function sectionBody(loaded: LoadedSource): string {
  return loaded.kind === "sheet" ? serializeSheets(loaded.tabs) : loaded.text;
}

/** 자료를 병렬로 읽는다. 하나라도 실패하면 그 자료 제목을 단 SheetError. 합계가 상한을 넘어도 실패. */
export async function loadSources(sources: SourceRow[]): Promise<LoadedSource[]> {
  const loaded = await Promise.all(sources.map(loadOne));
  const total = loaded.reduce((sum, entry) => sum + sectionBody(entry).length, 0);
  if (total > MAX_SHEET_CHARS) throw new SheetError("sources_too_large");
  return loaded;
}

/** 모델에 싣는 본문. `# 시트: 제목` / `# 문서: 제목` 구간, 구간 사이 빈 줄 둘. */
export function serializeSources(loaded: LoadedSource[]): string {
  return loaded
    .map((entry) => {
      const label = entry.kind === "sheet" ? "시트" : "문서";
      return `# ${label}: ${entry.source.title}\n\n${sectionBody(entry)}`;
    })
    .join("\n\n\n");
}
```

파일 상단 주석의 "읽기·직렬화는 Task 4에서 이 파일에 덧붙인다" 문장을 "읽기·직렬화도 여기서 한다"로 바꾼다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/lib/assistant-sources.test.ts`
Expected: PASS (12 tests). `readSpreadsheet`이 내부에서 `MAX_SHEET_CHARS`를 이미 검사하므로 시트 하나만으로 초과하는 경우는 그쪽에서 걸린다.

- [ ] **Step 5: 커밋**

```bash
git add lib/assistant-sources.ts tests/lib/assistant-sources.test.ts
git commit -m "feat: load and serialize every linked source for the assistant prompt"
```

---

### Task 5: 프롬프트·도구·제안에 자료 반영

**Files:**
- Modify: `lib/assistant.ts`
- Modify: `tests/lib/assistant.test.ts`

**Interfaces:**
- Consumes: `LoadedSource` from `@/lib/assistant-sources`; `prepareProposal`, `SheetProposal`, `Proposal` from `@/lib/sheets`
- Produces:
  ```ts
  export function buildAssistantPrompt(input: { gameName: string; today: string; sourcesText: string; attachmentsText?: string }): string
  export async function* streamAssistant(input: { system: string; history: HistoryMessage[]; sources: LoadedSource[] }): AsyncGenerator<AssistantEvent>
  ```
  `describeProposal`은 "시트 수정 제안: {sourceTitle} 시트 {sheet} 탭 …"으로 시작한다.

- [ ] **Step 1: 테스트 수정**

`tests/lib/assistant.test.ts`에서:

1. `buildAssistantPrompt` 테스트의 `sheetText:`를 `sourcesText:`로 바꾸고, 기대값 `"# 시트 내용"`을 `"# 연결된 자료"`로 바꾸며 다음 기대를 추가한다:
```ts
    expect(system).toContain("VIP 시트 VIP 탭 7행");
    expect(system).toContain("운영 가이드 문서");
    expect(system).toContain("문서는 읽기만");
```
2. 파일 상단 fixture를 바꾼다:
```ts
const vipSource = { id: "s1", gameId: "g1", kind: "sheet" as const, externalId: "sh1", title: "VIP 원장", createdAt: "" };
const sources = [{ source: vipSource, kind: "sheet" as const, tabs: [vip] }];
```
3. `describeProposal`·`historyToMessages` 테스트의 proposal fixture에 `sourceId: "s1", sourceTitle: "VIP 원장"`을 넣고, 기대 문자열이 `"시트 수정 제안: VIP 원장 시트 VIP 탭 2행 …"`(update) / `"시트 수정 제안: VIP 원장 시트 VIP 탭에 행 추가 …"`(append)로 시작하도록 바꾼다.
4. `streamAssistant` 테스트에서 `tabs: [vip]`를 모두 `sources`로 바꾼다. 도구 호출 fixture의 arguments JSON에 `"spreadsheet":"VIP 원장"`을 넣고, 기대 proposal에 `sourceId: "s1", sourceTitle: "VIP 원장"`을 추가한다. "streams text deltas and sends system + history + tools" 테스트에서 tools 인자 검사에 다음을 더한다:
```ts
    const tools = createMock.mock.calls[0][0].tools;
    expect(tools[0].function.parameters.properties.spreadsheet).toBeDefined();
    expect(tools[0].function.parameters.required).toContain("spreadsheet");
```
5. 새 테스트를 추가한다:
```ts
  it("yields invalid_proposal when the spreadsheet title matches no linked sheet", async () => {
    process.env.OPENAI_API_KEY = "k";
    createMock.mockResolvedValue(
      chunks({ tool_calls: [{ index: 0, function: { name: "propose_update", arguments: JSON.stringify({ spreadsheet: "없는 시트", sheet: "VIP", row: 2, updates: [{ column: "VIP 단계", before: "VIP3", after: "VIP4" }] }) } }] })
    );
    const events = await collect(streamAssistant({ system: "s", history: [], sources }));
    expect(events).toEqual([{ type: "error", reason: "invalid_proposal" }]);
  });

  it("picks the first linked sheet when two share a title", async () => {
    process.env.OPENAI_API_KEY = "k";
    const twin = { source: { ...vipSource, id: "s9", externalId: "sh9" }, kind: "sheet" as const, tabs: [vip] };
    createMock.mockResolvedValue(
      chunks({ tool_calls: [{ index: 0, function: { name: "propose_append", arguments: JSON.stringify({ spreadsheet: "VIP 원장", sheet: "VIP", values: { "이메일": "c@x.com" } }) } }] })
    );
    const events = await collect(streamAssistant({ system: "s", history: [], sources: [...sources, twin] }));
    expect(events[0]).toMatchObject({ type: "proposal", proposal: { sourceId: "s1" } });
  });
```
(기존 테스트가 `OPENAI_API_KEY`를 어떻게 설정·해제하는지 파일의 `beforeEach`/`afterEach`를 따른다.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/lib/assistant.test.ts`
Expected: FAIL — 프롬프트 문구 없음, `sources` 미지원

- [ ] **Step 3: 구현**

`lib/assistant.ts`:

import를 바꾼다:
```ts
import { prepareProposal, type Proposal, type SheetErrorReason } from "@/lib/sheets";
import type { LoadedSource } from "@/lib/assistant-sources";
```

`buildAssistantPrompt`를 다음으로 교체한다(첨부 파일 규칙은 다른 세션이 넣은 것을 유지한다):

```ts
export function buildAssistantPrompt(input: { gameName: string; today: string; sourcesText: string; attachmentsText?: string }): string {
  const attachmentsText = input.attachmentsText?.trim() ?? "";
  return [
    `당신은 게임 "${input.gameName}"의 운영 담당자를 돕는 어시스턴트입니다.`,
    "아래 연결된 자료(구글 시트·문서) 내용만 근거로 한국어로 답하세요.",
    "",
    "규칙:",
    '- 답할 때 근거가 된 자료를 짧게 덧붙이세요. 시트는 "VIP 시트 VIP 탭 7행", 문서는 "운영 가이드 문서"처럼.',
    '- 자료에 없는 내용은 "자료에서 찾지 못했습니다"라고 말하고 추측하지 마세요.',
    "- 시트는 propose_update 또는 propose_append 도구로 수정을 제안할 수 있습니다. 사용자가 시트를 바꾸자고 하면 본문으로 설명하지 말고 도구를 부르세요.",
    "  spreadsheet에는 `# 시트:` 뒤의 시트 제목을, row와 before는 표에서 본 값을 그대로 넣으세요. 첫 줄이 열 이름인 탭에서만 수정할 수 있습니다.",
    "- 문서는 읽기만 합니다. 문서를 고치자고 하면 도구를 부르지 말고 구글 문서에서 직접 수정해야 한다고 안내하세요.",
    `- 갱신일·날짜 같은 열이 있으면 오늘 날짜(${input.today})도 함께 넣으세요.`,
    "- 대상 행이 여럿이거나 특정할 수 없으면 도구를 부르지 말고 어느 것인지 되묻으세요.",
    "- 표의 행 번호는 시트의 실제 행 번호입니다(1행이 열 이름).",
    ...(attachmentsText
      ? [
          "- 사용자가 대화에 올린 첨부 파일도 근거로 쓰세요. 파일 이름을 밝히되, 파일은 수정할 수 없으니 파일 내용을 바꾸자는 요청에는 도구를 부르지 마세요.",
        ]
      : []),
    "",
    `오늘 날짜: ${input.today}`,
    "",
    "# 연결된 자료",
    "",
    input.sourcesText,
    ...(attachmentsText ? ["", "# 첨부 파일", "", attachmentsText] : []),
  ].join("\n");
}
```

`describeProposal`을 바꾼다:
```ts
export function describeProposal(proposal: Proposal, status: ProposalStatus | null): string {
  const suffix = ` (${STATUS_LABELS[status ?? "pending"]})`;
  const where = `${proposal.sourceTitle} 시트 ${proposal.sheet} 탭`;
  if (proposal.kind === "update") {
    const changes = proposal.updates.map((update) => `${update.column} '${update.before}' → '${update.after}'`).join(", ");
    return `시트 수정 제안: ${where} ${proposal.row}행 ${changes}${suffix}`;
  }
  const values = Object.entries(proposal.values)
    .map(([column, value]) => `${column} '${value}'`)
    .join(", ");
  return `시트 수정 제안: ${where}에 행 추가 ${values}${suffix}`;
}
```

`PROPOSAL_TOOLS` 두 도구의 `properties` 맨 앞에 `spreadsheet: { type: "string", description: "`# 시트:` 뒤에 적힌 시트 제목" }`을 넣고 `required` 배열 맨 앞에 `"spreadsheet"`를 넣는다.

`toolCallToRaw`는 그대로 두고, `streamAssistant`의 시그니처와 마지막 루프를 바꾼다:

```ts
export async function* streamAssistant(input: {
  system: string;
  history: HistoryMessage[];
  sources: LoadedSource[];
}): AsyncGenerator<AssistantEvent> {
```

```ts
  for (const call of toolCalls.values()) {
    const proposal = proposalFromToolCall(input.sources, call.name, call.args);
    if (!proposal) {
      yield { type: "error", reason: "invalid_proposal" };
      return;
    }
    yield { type: "proposal", proposal };
  }
```

파일에 함수 추가:

```ts
/** 도구 인자의 spreadsheet(시트 제목)로 자료를 고르고, 그 시트의 탭으로 검증해 sourceId를 붙인다. 같은 제목이면 먼저 등록된 것. */
function proposalFromToolCall(sources: LoadedSource[], name: string, args: string): Proposal | null {
  const raw = toolCallToRaw(name, args);
  if (!raw || typeof raw !== "object") return null;
  const { spreadsheet, ...rest } = raw as { spreadsheet?: unknown } & Record<string, unknown>;
  const match = sources.find((entry): entry is Extract<LoadedSource, { kind: "sheet" }> => entry.kind === "sheet" && entry.source.title === spreadsheet);
  if (!match) return null;
  const prepared = prepareProposal(match.tabs, rest);
  if (!prepared) return null;
  return { ...prepared, sourceId: match.source.id, sourceTitle: match.source.title };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/lib/assistant.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/assistant.ts tests/lib/assistant.test.ts
git commit -m "feat: assistant prompt and tools address multiple linked sources"
```

---

### Task 6: 자료 등록·해제 API, 게임 PATCH 제거

**Files:**
- Create: `app/api/games/[gameId]/sources/route.ts`
- Create: `app/api/games/[gameId]/sources/[sourceId]/route.ts`
- Modify: `app/api/games/[gameId]/route.ts` (PATCH·관련 import 제거)
- Delete: `tests/api/game-sheet.test.ts`
- Test: `tests/api/game-sources.test.ts`

**Interfaces:**
- Consumes: `parseSourceUrl`, `insertSource`, `deleteSource` from `@/lib/assistant-sources`; `readSpreadsheetTitle`, `SheetError` from `@/lib/sheets`; `readDocument` from `@/lib/docs`; `requireAdminSession`
- Produces: `POST /api/games/{gameId}/sources` `{ url }` → `{ success: true, source }` | `{ success: false, error }`; `DELETE /api/games/{gameId}/sources/{sourceId}` → `{ success: true }`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/api/game-sources.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/games/[gameId]/sources/route";
import { DELETE } from "@/app/api/games/[gameId]/sources/[sourceId]/route";
import * as sessionModule from "@/lib/require-admin-session";
import * as sourcesModule from "@/lib/assistant-sources";
import * as sheetsModule from "@/lib/sheets";
import * as docsModule from "@/lib/docs";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn(() => ({ from: vi.fn() })) }));
vi.mock("@/lib/require-admin-session", () => ({ requireAdminSession: vi.fn(), getAdminSession: vi.fn() }));
vi.mock("@/lib/assistant-sources", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/assistant-sources")>();
  return { ...actual, insertSource: vi.fn(), deleteSource: vi.fn() };
});
vi.mock("@/lib/sheets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sheets")>();
  return { ...actual, readSpreadsheetTitle: vi.fn() };
});
vi.mock("@/lib/docs", () => ({ readDocument: vi.fn() }));

const saved = { id: "s1", gameId: "g1", kind: "sheet" as const, externalId: "1AbC", title: "VIP 원장", createdAt: "" };

function post(body: unknown) {
  return new Request("http://localhost/api/games/g1/sources", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/games/[gameId]/sources", () => {
  beforeEach(() => {
    vi.mocked(sessionModule.requireAdminSession).mockReset().mockResolvedValue(true);
    vi.mocked(sourcesModule.insertSource).mockReset().mockResolvedValue(saved);
    vi.mocked(sheetsModule.readSpreadsheetTitle).mockReset().mockResolvedValue("VIP 원장");
    vi.mocked(docsModule.readDocument).mockReset().mockResolvedValue({ title: "운영 가이드", text: "" });
  });

  it("returns 401 without a session", async () => {
    vi.mocked(sessionModule.requireAdminSession).mockResolvedValue(false);
    expect((await POST(post({ url: "x" }), { params: { gameId: "g1" } })).status).toBe(401);
  });

  it("rejects a url that is not a sheet or doc", async () => {
    const response = await POST(post({ url: "1AbC" }), { params: { gameId: "g1" } });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: "invalid_input" });
    expect(sourcesModule.insertSource).not.toHaveBeenCalled();
  });

  it("reads the sheet title and stores the source", async () => {
    const response = await POST(post({ url: "https://docs.google.com/spreadsheets/d/1AbC/edit" }), { params: { gameId: "g1" } });
    expect(await response.json()).toEqual({ success: true, source: saved });
    expect(sheetsModule.readSpreadsheetTitle).toHaveBeenCalledWith("1AbC");
    expect(sourcesModule.insertSource).toHaveBeenCalledWith(expect.anything(), { gameId: "g1", kind: "sheet", externalId: "1AbC", title: "VIP 원장" });
  });

  it("reads a document title for doc urls", async () => {
    await POST(post({ url: "https://docs.google.com/document/d/1DoC/edit" }), { params: { gameId: "g1" } });
    expect(docsModule.readDocument).toHaveBeenCalledWith("1DoC");
    expect(sourcesModule.insertSource).toHaveBeenCalledWith(expect.anything(), { gameId: "g1", kind: "doc", externalId: "1DoC", title: "운영 가이드" });
  });

  it("returns the read failure reason with 200 so the dialog can explain", async () => {
    vi.mocked(sheetsModule.readSpreadsheetTitle).mockRejectedValue(new sheetsModule.SheetError("source_forbidden"));
    const response = await POST(post({ url: "https://docs.google.com/spreadsheets/d/1AbC/edit" }), { params: { gameId: "g1" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: false, error: "source_forbidden" });
    expect(sourcesModule.insertSource).not.toHaveBeenCalled();
  });

  it("returns 409 duplicate", async () => {
    vi.mocked(sourcesModule.insertSource).mockResolvedValue("duplicate");
    const response = await POST(post({ url: "https://docs.google.com/spreadsheets/d/1AbC/edit" }), { params: { gameId: "g1" } });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, error: "duplicate" });
  });

  it("returns 500 when saving fails", async () => {
    vi.mocked(sourcesModule.insertSource).mockResolvedValue(null);
    const response = await POST(post({ url: "https://docs.google.com/spreadsheets/d/1AbC/edit" }), { params: { gameId: "g1" } });
    expect(response.status).toBe(500);
  });
});

describe("DELETE /api/games/[gameId]/sources/[sourceId]", () => {
  const req = () => new Request("http://localhost/x", { method: "DELETE" });

  beforeEach(() => {
    vi.mocked(sessionModule.requireAdminSession).mockReset().mockResolvedValue(true);
    vi.mocked(sourcesModule.deleteSource).mockReset().mockResolvedValue(true);
  });

  it("returns 401 without a session", async () => {
    vi.mocked(sessionModule.requireAdminSession).mockResolvedValue(false);
    expect((await DELETE(req(), { params: { gameId: "g1", sourceId: "s1" } })).status).toBe(401);
  });

  it("deletes within the game", async () => {
    const response = await DELETE(req(), { params: { gameId: "g1", sourceId: "s1" } });
    expect(await response.json()).toEqual({ success: true });
    expect(sourcesModule.deleteSource).toHaveBeenCalledWith(expect.anything(), "g1", "s1");
  });

  it("returns 404 when nothing was deleted", async () => {
    vi.mocked(sourcesModule.deleteSource).mockResolvedValue(false);
    expect((await DELETE(req(), { params: { gameId: "g1", sourceId: "s1" } })).status).toBe(404);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/api/game-sources.test.ts`
Expected: FAIL — 라우트 모듈 없음

- [ ] **Step 3: 라우트 구현**

`app/api/games/[gameId]/sources/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { insertSource, parseSourceUrl } from "@/lib/assistant-sources";
import { readSpreadsheetTitle, SheetError } from "@/lib/sheets";
import { readDocument } from "@/lib/docs";

/**
 * 자료(구글 시트·문서) 등록. 등록 시점에 제목을 읽어 저장하므로, 공유가 안 돼 있으면
 * 여기서 바로 거절되어 관리자가 원인을 안다. 읽기 실패는 200으로 사유를 돌려준다.
 */
export async function POST(request: Request, { params }: { params: { gameId: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "invalid_input" }, { status: 400 });
  }
  const url = typeof parsed === "object" && parsed !== null && typeof (parsed as { url?: unknown }).url === "string" ? (parsed as { url: string }).url : "";
  const target = parseSourceUrl(url);
  if (!target) {
    return NextResponse.json({ success: false, error: "invalid_input" }, { status: 400 });
  }

  let title: string;
  try {
    title = target.kind === "sheet" ? await readSpreadsheetTitle(target.externalId) : (await readDocument(target.externalId)).title;
  } catch (error) {
    const reason = error instanceof SheetError ? error.reason : "source_read_failed";
    return NextResponse.json({ success: false, error: reason });
  }

  const source = await insertSource(getSupabaseServerClient(), { gameId: params.gameId, kind: target.kind, externalId: target.externalId, title });
  if (source === "duplicate") {
    return NextResponse.json({ success: false, error: "duplicate" }, { status: 409 });
  }
  if (!source) {
    return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
  }
  return NextResponse.json({ success: true, source });
}
```

`app/api/games/[gameId]/sources/[sourceId]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { deleteSource } from "@/lib/assistant-sources";

export async function DELETE(_request: Request, { params }: { params: { gameId: string; sourceId: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }
  const ok = await deleteSource(getSupabaseServerClient(), params.gameId, params.sourceId);
  if (!ok) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: 게임 PATCH 제거**

`app/api/games/[gameId]/route.ts`에서 `PATCH` 함수 전체와 그 위 주석, 그리고 `import { parseSheetUrl, serviceAccountEmail } from "@/lib/sheets";` 줄을 지운다. `tests/api/game-sheet.test.ts`를 삭제한다:

```bash
git rm tests/api/game-sheet.test.ts
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/api/game-sources.test.ts tests/api/game-delete.test.ts tests/api/games.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add app/api/games/\[gameId\]/sources app/api/games/\[gameId\]/route.ts tests/api/game-sources.test.ts
git commit -m "feat: routes to link and unlink assistant sources; drop game sheetUrl PATCH"
```

---

### Task 7: 메시지·적용 라우트가 자료 목록을 쓴다

**Files:**
- Modify: `app/api/assistant/conversations/[id]/messages/route.ts`
- Modify: `app/api/assistant/messages/[id]/apply/route.ts`
- Modify: `tests/api/assistant-messages.test.ts`
- Modify: `tests/api/assistant-apply.test.ts`

**이 작업 전에 반드시** `git status`로 두 라우트·테스트 파일에 다른 세션의 미커밋 변경이 있는지 본다. 있으면 그 내용을 읽고 그 위에 아래 변경을 얹는다. 첨부 파일(`attachments`) 관련 코드는 건드리지 않는다.

**Interfaces:**
- Consumes: `listSources`, `loadSources`, `serializeSources`, `getSource` from `@/lib/assistant-sources`; `buildAssistantPrompt({ sourcesText })`, `streamAssistant({ sources })` from `@/lib/assistant`; `applyProposal` from `@/lib/sheets`
- Produces: 스트림 error 이벤트 `{ type: "error", reason, sourceTitle? }`

- [ ] **Step 1: 메시지 라우트 테스트 수정**

`tests/api/assistant-messages.test.ts`에서:

1. mock 추가:
```ts
import * as sourcesModule from "@/lib/assistant-sources";
vi.mock("@/lib/assistant-sources", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/assistant-sources")>();
  return { ...actual, listSources: vi.fn(), loadSources: vi.fn() };
});
```
`@/lib/sheets` mock에서 `readSpreadsheet: vi.fn()`은 남겨도 되지만 더는 쓰지 않으므로 지운다.
2. fixture:
```ts
const game = { id: "g1", name: "여신 키우기", status: "active", logoPath: null, ownerName: null, createdAt: "" };
const sheetSource = { id: "s1", gameId: "g1", kind: "sheet" as const, externalId: "sheet-1", title: "VIP 원장", createdAt: "" };
const docSource = { id: "s2", gameId: "g1", kind: "doc" as const, externalId: "doc-1", title: "운영 가이드", createdAt: "" };
const loaded = [
  { source: sheetSource, kind: "sheet" as const, tabs },
  { source: docSource, kind: "doc" as const, text: "환불은 7일" },
];
const proposal = { kind: "update" as const, sourceId: "s1", sourceTitle: "VIP 원장", sheet: "VIP", row: 2, updates: [{ column: "VIP 단계", before: "VIP3", after: "VIP4" }] };
```
3. `beforeEach`에 추가:
```ts
    vi.mocked(sourcesModule.listSources).mockReset().mockResolvedValue([sheetSource, docSource]);
    vi.mocked(sourcesModule.loadSources).mockReset().mockResolvedValue(loaded);
```
기존 `vi.mocked(sheetsModule.readSpreadsheet).mockReset().mockResolvedValue(tabs)` 줄은 지운다.
4. "returns 400 not_configured when the game has no sheet" 테스트를 바꾼다:
```ts
  it("returns 400 not_configured when the game has no sources", async () => {
    vi.mocked(sourcesModule.listSources).mockResolvedValue([]);
    const response = await POST(request({ content: "hi" }), { params: { id: "c1" } });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: "not_configured" });
  });
```
5. "streams a sheet read failure as one error event and keeps the user message" 테스트를 바꾼다:
```ts
  it("streams a source read failure with its title as one error event and keeps the user message", async () => {
    const error = new sheetsModule.SheetError("source_forbidden");
    error.sourceTitle = "운영 가이드";
    vi.mocked(sourcesModule.loadSources).mockRejectedValue(error);
    const response = await POST(request({ content: "hi" }), { params: { id: "c1" } });
    expect(await events(response)).toEqual([{ type: "error", reason: "source_forbidden", sourceTitle: "운영 가이드" }]);
    expect(storeModule.insertMessage).toHaveBeenCalledTimes(1);
  });
```
6. "stores the user message, streams text, and stores the assistant reply" 테스트에 프롬프트 검사를 추가한다:
```ts
    const call = vi.mocked(assistantModule.streamAssistant).mock.calls[0][0];
    expect(call.system).toContain("# 시트: VIP 원장");
    expect(call.system).toContain("# 문서: 운영 가이드");
    expect(call.sources).toBe(loaded);
```
7. 그 외 `tabs`를 `streamAssistant` 인자로 검사하던 곳은 `sources`로 바꾼다.

- [ ] **Step 2: 적용 라우트 테스트 수정**

`tests/api/assistant-apply.test.ts`에서:

1. `@/lib/categories` mock과 `categoriesModule` import를 지우고 대신:
```ts
import * as sourcesModule from "@/lib/assistant-sources";
vi.mock("@/lib/assistant-sources", () => ({ getSource: vi.fn() }));
```
2. fixture: `proposal`에 `sourceId: "s1", sourceTitle: "VIP 원장"` 추가. `game` 상수는 지우고:
```ts
const source = { id: "s1", gameId: "g1", kind: "sheet" as const, externalId: "sheet-1", title: "VIP 원장", createdAt: "" };
```
3. `beforeEach`의 `listGames` 줄을 `vi.mocked(sourcesModule.getSource).mockReset().mockResolvedValue(source);`로.
4. "fails with not_configured when the game lost its sheet"를 다음 셋으로 바꾼다:
```ts
  it("fails with invalid_proposal when the source is gone", async () => {
    vi.mocked(sourcesModule.getSource).mockResolvedValue(null);
    const response = await apply(req(), { params: { id: "m1" } });
    expect(await response.json()).toEqual({ success: false, status: "failed", failureReason: "invalid_proposal" });
    expect(sheetsModule.applyProposal).not.toHaveBeenCalled();
  });

  it("fails with invalid_proposal when the source belongs to another game or is a doc", async () => {
    vi.mocked(sourcesModule.getSource).mockResolvedValue({ ...source, gameId: "g2" });
    expect(await (await apply(req(), { params: { id: "m1" } })).json()).toMatchObject({ failureReason: "invalid_proposal" });
    vi.mocked(sourcesModule.getSource).mockResolvedValue({ ...source, kind: "doc" });
    expect(await (await apply(req(), { params: { id: "m1" } })).json()).toMatchObject({ failureReason: "invalid_proposal" });
  });

  it("fails with invalid_proposal for a proposal saved before sources existed", async () => {
    const { sourceId: _omit, ...legacy } = proposal;
    vi.mocked(storeModule.getMessage).mockResolvedValue({ ...message, proposal: legacy as never });
    expect(await (await apply(req(), { params: { id: "m1" } })).json()).toMatchObject({ failureReason: "invalid_proposal" });
    expect(sourcesModule.getSource).not.toHaveBeenCalled();
  });
```
5. "applies the proposal and records who did it"의 `applyProposal` 기대는 그대로 `("sheet-1", proposal)`.

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run tests/api/assistant-messages.test.ts tests/api/assistant-apply.test.ts`
Expected: FAIL

- [ ] **Step 4: 메시지 라우트 수정**

`app/api/assistant/conversations/[id]/messages/route.ts`:

- import: `import { readSpreadsheet, serializeSheets, SheetError, type Proposal } from "@/lib/sheets";` → `import { SheetError, type Proposal } from "@/lib/sheets";` 그리고 `import { listSources, loadSources, serializeSources } from "@/lib/assistant-sources";` 추가.
- `StreamEvent`의 error를 `{ type: "error"; reason: AssistantErrorReason | "save_failed"; sourceTitle?: string }`로.
- 게임 조회 뒤의
  ```ts
  if (!game.sheetId) { ... }
  const sheetId = game.sheetId;
  ```
  를 다음으로:
  ```ts
  const sources = await listSources(supabase, game.id);
  if (sources.length === 0) {
    return NextResponse.json({ success: false, error: "not_configured" }, { status: 400 });
  }
  ```
- `run()` 안의 시트 읽기를:
  ```ts
    let loaded;
    try {
      loaded = await loadSources(sources);
    } catch (error) {
      if (error instanceof SheetError) {
        yield { type: "error", reason: error.reason, ...(error.sourceTitle ? { sourceTitle: error.sourceTitle } : {}) };
      } else {
        yield { type: "error", reason: "source_read_failed" };
      }
      return;
    }
  ```
- `buildAssistantPrompt`의 `sheetText: serializeSheets(tabs)` → `sourcesText: serializeSources(loaded)`.
- `streamAssistant({ system, history: toHistory(messages), tabs })` → `streamAssistant({ system, history: toHistory(messages), sources: loaded })`.

- [ ] **Step 5: 적용 라우트 수정**

`app/api/assistant/messages/[id]/apply/route.ts`:

- `import { listGames } from "@/lib/categories";` 삭제, `import { getSource } from "@/lib/assistant-sources";` 추가.
- 대화·게임 조회 이후를 다음으로 바꾼다:
  ```ts
  const conversation = await getConversation(supabase, message.conversationId);

  const fail = async (reason: SheetErrorReason) => {
    await updateProposalStatus(supabase, message.id, { status: "failed", failureReason: reason });
    return NextResponse.json({ success: false, status: "failed", failureReason: reason });
  };

  // 0017 이전에 저장된 제안은 sourceId가 없다. 자료가 해제됐거나 다른 게임·문서를 가리켜도 적용하지 않는다.
  const sourceId = typeof message.proposal.sourceId === "string" ? message.proposal.sourceId : null;
  const source = sourceId ? await getSource(supabase, sourceId) : null;
  if (!conversation || !source || source.kind !== "sheet" || source.gameId !== conversation.gameId) {
    return fail("invalid_proposal");
  }

  try {
    await applyProposal(source.externalId, message.proposal);
  } catch (error) {
    return fail(error instanceof SheetError ? error.reason : "sheet_write_failed");
  }
  ```
  (`if (!game?.sheetId) return fail("not_configured")` 블록은 삭제.)

- [ ] **Step 6: 통과 확인**

Run: `npx vitest run tests/api/assistant-messages.test.ts tests/api/assistant-apply.test.ts`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add "app/api/assistant/conversations/[id]/messages/route.ts" "app/api/assistant/messages/[id]/apply/route.ts" tests/api/assistant-messages.test.ts tests/api/assistant-apply.test.ts
git commit -m "feat: assistant routes read every linked source and apply by sourceId"
```

---

### Task 8: 화면 — 자료 목록, 추가 대화상자, 문구

**Files:**
- Modify: `components/assistant/ConversationSidebar.tsx`
- Create: `components/assistant/SourceAddDialog.tsx`
- Delete: `components/assistant/SheetSettingsDialog.tsx`, `tests/components/SheetSettingsDialog.test.tsx`
- Modify: `components/assistant/AssistantShell.tsx`, `components/assistant/ProposalCard.tsx`, `components/assistant/ChatPane.tsx`, `components/assistant/messages.ts`
- Modify: `app/(assistant)/games/[gameId]/assistant/page.tsx`
- Test: `tests/components/ConversationSidebar.test.tsx`, `tests/components/SourceAddDialog.test.tsx`, `tests/components/AssistantShell.test.tsx`

**이 작업 전에** `git status`로 `components/assistant/ChatPane.tsx`에 다른 세션의 미커밋 변경(첨부 파일 UI)이 있는지 본다. 있으면 그 내용 위에 아래의 오류 문구 변경만 얹는다.

**Interfaces:**
- Consumes: `SourceRow`, `sourceUrl` from `@/lib/assistant-sources`; `serviceAccountEmail` from `@/lib/sheets`
- Produces:
  ```ts
  // messages.ts
  export function streamErrorMessage(reason: string, sourceTitle?: string): string
  // ConversationSidebar props
  { gameId; gameName; conversations; selectedId; sources: SourceRow[]; onAddSource: () => void }
  // AssistantShell props
  { game: { id; name }; sources: SourceRow[]; conversations; selectedId; messages; serviceAccountEmail }
  // SourceAddDialog props
  { gameId; serviceAccountEmail: string | null; onClose: () => void }
  ```

- [ ] **Step 1: 사이드바 테스트 작성**

`tests/components/ConversationSidebar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConversationSidebar from "@/components/assistant/ConversationSidebar";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));

const sources = [
  { id: "s1", gameId: "g1", kind: "sheet" as const, externalId: "1AbC", title: "VIP 원장", createdAt: "" },
  { id: "s2", gameId: "g1", kind: "doc" as const, externalId: "1DoC", title: "운영 가이드", createdAt: "" },
];

function renderSidebar(overrides: Partial<React.ComponentProps<typeof ConversationSidebar>> = {}) {
  return render(
    <ConversationSidebar gameId="g1" gameName="여신 키우기" conversations={[]} selectedId={null} sources={sources} onAddSource={vi.fn()} {...overrides} />
  );
}

describe("ConversationSidebar sources", () => {
  beforeEach(() => {
    refresh.mockReset();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true }) }) as never;
  });

  it("lists each source as a new-tab link with its kind", () => {
    renderSidebar();
    const sheet = screen.getByRole("link", { name: /VIP 원장/ });
    expect(sheet).toHaveAttribute("href", "https://docs.google.com/spreadsheets/d/1AbC/edit");
    expect(sheet).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: /운영 가이드/ })).toHaveAttribute("href", "https://docs.google.com/document/d/1DoC/edit");
    expect(screen.getByLabelText("시트")).toBeInTheDocument();
    expect(screen.getByLabelText("문서")).toBeInTheDocument();
  });

  it("shows an empty note when nothing is linked", () => {
    renderSidebar({ sources: [] });
    expect(screen.getByText("연결된 자료가 없습니다")).toBeInTheDocument();
  });

  it("opens the add dialog from the add button", async () => {
    const onAddSource = vi.fn();
    renderSidebar({ onAddSource });
    await userEvent.click(screen.getByRole("button", { name: "+ 자료 추가" }));
    expect(onAddSource).toHaveBeenCalled();
  });

  it("unlinks a source and refreshes", async () => {
    renderSidebar();
    await userEvent.click(screen.getByRole("button", { name: "운영 가이드 연결 해제" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/games/g1/sources/s2", { method: "DELETE" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("no longer offers the old sheet settings button", () => {
    renderSidebar();
    expect(screen.queryByText(/시트 설정/)).toBeNull();
  });
});
```

- [ ] **Step 2: 대화상자 테스트 작성**

`tests/components/SourceAddDialog.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SourceAddDialog from "@/components/assistant/SourceAddDialog";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));

async function submit(url: string) {
  await userEvent.type(screen.getByLabelText("자료 URL"), url);
  await userEvent.click(screen.getByRole("button", { name: "추가" }));
}

describe("SourceAddDialog", () => {
  beforeEach(() => {
    refresh.mockReset();
    global.fetch = vi.fn() as never;
  });

  it("shows the service account to share with", () => {
    render(<SourceAddDialog gameId="g1" serviceAccountEmail="bot@proj.iam.gserviceaccount.com" onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "자료 추가" })).toBeInTheDocument();
    expect(screen.getByText("bot@proj.iam.gserviceaccount.com")).toBeInTheDocument();
  });

  it("tells the admin to set the env var when there is no service account", () => {
    render(<SourceAddDialog gameId="g1" serviceAccountEmail={null} onClose={vi.fn()} />);
    expect(screen.getByText(/GOOGLE_SERVICE_ACCOUNT_JSON/)).toBeInTheDocument();
  });

  it("posts the url, refreshes, and closes", async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true, source: { id: "s1" } }) } as never);
    const onClose = vi.fn();
    render(<SourceAddDialog gameId="g1" serviceAccountEmail="bot@x" onClose={onClose} />);
    await submit("https://docs.google.com/document/d/1DoC/edit");
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/games/g1/sources", expect.objectContaining({ method: "POST", body: JSON.stringify({ url: "https://docs.google.com/document/d/1DoC/edit" }) })));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it.each([
    ["invalid_input", "구글 시트 또는 문서의 URL 전체를 붙여넣으세요."],
    ["source_forbidden", "읽을 권한이 없습니다. 위 서비스 계정에 먼저 공유한 뒤 다시 시도하세요."],
    ["source_not_found", "자료를 찾을 수 없습니다. URL을 확인하세요."],
    ["duplicate", "이미 연결된 자료입니다."],
    ["not_configured", "서비스 계정이 설정되지 않았습니다."],
    ["save_failed", "저장하지 못했습니다."],
  ])("explains %s inline", async (error, text) => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: false, json: () => Promise.resolve({ success: false, error }) } as never);
    const onClose = vi.fn();
    render(<SourceAddDialog gameId="g1" serviceAccountEmail="bot@x" onClose={onClose} />);
    await submit("https://docs.google.com/document/d/1DoC/edit");
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: AssistantShell 테스트 수정**

`tests/components/AssistantShell.test.tsx`에서 `game`을 `{ id: "g1", name: "여신 키우기" }`로 바꾸고, 모든 `<AssistantShell ...>`에 `sources={sources}`를 넣는다:
```ts
const sources = [{ id: "s1", gameId: "g1", kind: "sheet" as const, externalId: "1AbC", title: "VIP 원장", createdAt: "" }];
```
테스트 추가:
```tsx
  it("asks to add a source when none is linked", () => {
    render(<AssistantShell game={game} sources={[]} conversations={[]} selectedId={null} messages={[]} serviceAccountEmail={null} />);
    expect(screen.getByText("이 게임에 연결된 자료가 없습니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "자료 추가하기" })).toBeInTheDocument();
    expect(screen.queryByLabelText("메시지")).toBeNull();
  });
```

- [ ] **Step 4: 실패 확인**

Run: `npx vitest run tests/components/ConversationSidebar.test.tsx tests/components/SourceAddDialog.test.tsx tests/components/AssistantShell.test.tsx`
Expected: FAIL

- [ ] **Step 5: `messages.ts` 수정**

다른 세션이 첨부 파일 사유(`unsupported_type`, `file_too_large`, `too_many_files`, `attachments_too_large`, `file_unreadable`)를 `STREAM_ERROR_MESSAGES`에 문자열로 넣고 `ChatPane`이 `STREAM_ERROR_MESSAGES.unsupported_type`처럼 직접 읽는다. 그 구조는 그대로 두고, 자료 관련 사유만 별도 표로 뺀다.

- `STREAM_ERROR_MESSAGES`에서 `source_forbidden`·`source_not_found`·`sources_too_large`·`source_read_failed` 네 키를 지운다(Task 2에서 이름만 바꿔 둔 것). 나머지 키와 첨부 파일 키는 손대지 않는다.
- `invalid_proposal` 문구를 "수정 제안을 만들지 못했습니다. 시트·탭·열 이름을 정확히 알려주고 다시 시도하세요."로.
- 아래를 추가한다(`GENERIC_ERROR` 선언 뒤에):

```ts
/** 자료 읽기 실패. 어느 자료인지 서버가 알려주면 제목을 넣는다. */
const SOURCE_ERROR_MESSAGES: Record<string, (title: string) => string> = {
  source_forbidden: (title) => `'${title}'을(를) 읽을 권한이 없습니다. 서비스 계정에 공유했는지 확인하세요.`,
  source_not_found: (title) => `'${title}'을(를) 찾을 수 없습니다. 연결을 해제하고 다시 추가하세요.`,
  sources_too_large: () => "연결된 자료가 너무 큽니다(합계 300,000자 초과).",
  source_read_failed: (title) => `'${title}'을(를) 읽지 못했습니다. 잠시 후 다시 시도하세요.`,
};

export function streamErrorMessage(reason: string, sourceTitle?: string): string {
  const source = SOURCE_ERROR_MESSAGES[reason];
  if (source) return source(sourceTitle ?? "자료");
  return STREAM_ERROR_MESSAGES[reason] ?? GENERIC_ERROR;
}
```

- `APPLY_FAILURE_MESSAGES.invalid_proposal`을 "제안이 시트 구조와 맞지 않거나 시트 연결이 해제됐습니다."로, `not_configured`를 "서비스 계정 설정이 없습니다."로 바꾼다.

- [ ] **Step 6: `ChatPane.tsx` 수정**

다른 세션의 첨부 파일 코드(`files` state, `pickFiles`, `buildRequest`, `AttachmentChips`)는 그대로 둔다. 바꾸는 곳은 넷뿐이다.

- import 줄에 `streamErrorMessage`를 추가한다(`STREAM_ERROR_MESSAGES`는 `pickFiles`가 쓰므로 남긴다).
- `StreamEvent`의 error를 `{ type: "error"; reason: string; sourceTitle?: string }`로.
- `let failure: string | null = null;` 아래에 `let failureTitle: string | undefined;`를 추가하고, error 이벤트 분기를 `failure = event.reason; failureTitle = event.sourceTitle;`로.
- `setError(STREAM_ERROR_MESSAGES[failure] ?? GENERIC_ERROR)` → `setError(streamErrorMessage(failure, failureTitle))`. 이후 `GENERIC_ERROR`를 파일에서 더 안 쓰면 import에서 뺀다.
- 빈 대화 안내 문구를 "연결된 시트·문서에 대해 물어보거나 시트 수정을 요청하세요. 예: “52009 VIP 몇이야”, “52009 VIP4로 올려줘”"로.

- [ ] **Step 7: `SourceAddDialog.tsx` 작성, `SheetSettingsDialog.tsx` 삭제**

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_input: "구글 시트 또는 문서의 URL 전체를 붙여넣으세요.",
  source_forbidden: "읽을 권한이 없습니다. 위 서비스 계정에 먼저 공유한 뒤 다시 시도하세요.",
  source_not_found: "자료를 찾을 수 없습니다. URL을 확인하세요.",
  duplicate: "이미 연결된 자료입니다.",
  not_configured: "서비스 계정이 설정되지 않았습니다.",
};

/** 구글 시트·문서 URL 하나를 받아 게임 자료로 등록한다. 종류는 서버가 URL로 판별한다. */
export default function SourceAddDialog({
  gameId,
  serviceAccountEmail,
  onClose,
}: {
  gameId: string;
  serviceAccountEmail: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/games/${gameId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const json = (await response.json()) as { success: boolean; error?: string };
      if (!json.success) {
        setError(ERROR_MESSAGES[json.error ?? ""] ?? "저장하지 못했습니다.");
        return;
      }
      router.refresh();
      onClose();
    } catch {
      setError("저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30" onClick={onClose}>
      <form
        role="dialog"
        aria-label="자료 추가"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-lg rounded-2xl bg-panel border border-line shadow-xl p-6 flex flex-col gap-4"
      >
        <h2 className="text-base font-bold">자료 추가</h2>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">구글 시트 또는 문서 URL</span>
          <input
            aria-label="자료 URL"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/… 또는 /document/d/…"
            className="rounded-lg border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </label>

        <div className="rounded-lg bg-ground px-3 py-2.5 text-xs leading-relaxed">
          {serviceAccountEmail ? (
            <>
              시트·문서를 아래 서비스 계정에 <strong>편집자</strong>로 공유한 뒤 추가하세요.
              <div className="mt-1 font-mono text-[12px] select-all">{serviceAccountEmail}</div>
              <div className="mt-2 text-muted">시트를 수정까지 쓰려면 탭의 첫 줄에 열 이름을 두세요(예: 이메일 / ID / VIP 단계 / 갱신일). 문서는 읽기만 합니다.</div>
            </>
          ) : (
            <>
              서비스 계정이 설정되지 않았습니다. 관리자 앱 환경변수 <code>GOOGLE_SERVICE_ACCOUNT_JSON</code>에 서비스 계정 키(JSON 한 줄)를 넣고 재배포하세요.
            </>
          )}
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-ground">
            닫기
          </button>
          <button type="submit" disabled={saving || !url.trim()} className="rounded-lg bg-accent text-white px-3 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50">
            추가
          </button>
        </div>
      </form>
    </div>
  );
}
```

```bash
git rm components/assistant/SheetSettingsDialog.tsx tests/components/SheetSettingsDialog.test.tsx
```

- [ ] **Step 8: `ConversationSidebar.tsx` 수정**

props에 `sources: SourceRow[]`, `onAddSource: () => void`를 넣고 `onOpenSettings`를 뺀다. import에 `import { sourceUrl, type SourceRow } from "@/lib/assistant-sources";` 추가. state에 `const [unlinking, setUnlinking] = useState<string | null>(null);` 추가.

함수 추가:
```tsx
  async function unlink(source: SourceRow) {
    setUnlinking(source.id);
    try {
      await fetch(`/api/games/${gameId}/sources/${source.id}`, { method: "DELETE" });
    } finally {
      setUnlinking(null);
    }
    router.refresh();
  }
```

헤더 블록(`<div className="px-4 pt-4 pb-3 flex flex-col gap-3">`) 안, 게임 이름 줄과 "+ 새 대화" 링크 사이에 넣는다:

```tsx
        <div className="flex flex-col gap-1" aria-label="연결된 자료">
          <span className="text-[11px] font-medium text-muted px-1">연결된 자료</span>
          {sources.length === 0 && <span className="px-1 text-xs text-muted">연결된 자료가 없습니다</span>}
          {sources.map((source) => (
            <div key={source.id} className="group relative">
              <a
                href={sourceUrl(source)}
                target="_blank"
                rel="noopener"
                className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 pr-7 text-sm hover:bg-ground/70"
              >
                <span aria-label={source.kind === "sheet" ? "시트" : "문서"} className="text-muted shrink-0">
                  {source.kind === "sheet" ? "▦" : "▤"}
                </span>
                <span className="truncate">{source.title}</span>
              </a>
              <button
                type="button"
                aria-label={`${source.title} 연결 해제`}
                onClick={() => void unlink(source)}
                disabled={unlinking === source.id}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-red-600 disabled:opacity-50"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          ))}
          <button type="button" onClick={onAddSource} className="text-left rounded-lg px-1.5 py-1 text-xs text-muted hover:bg-ground hover:text-ink">
            + 자료 추가
          </button>
        </div>
```

맨 아래 `<div className="border-t border-line p-2">…⚙ 시트 설정…</div>` 블록을 지운다.

- [ ] **Step 9: `AssistantShell.tsx`, `ProposalCard.tsx`, `page.tsx` 수정**

`AssistantShell.tsx`:
```tsx
"use client";

import { useState } from "react";
import type { ConversationRow } from "@/lib/assistant-store";
import type { SourceRow } from "@/lib/assistant-sources";
import ConversationSidebar from "@/components/assistant/ConversationSidebar";
import ChatPane from "@/components/assistant/ChatPane";
import SourceAddDialog from "@/components/assistant/SourceAddDialog";
import type { ChatMessage } from "@/components/assistant/messages";

export default function AssistantShell({
  game,
  sources,
  conversations,
  selectedId,
  messages,
  serviceAccountEmail,
}: {
  game: { id: string; name: string };
  sources: SourceRow[];
  conversations: ConversationRow[];
  selectedId: string | null;
  messages: ChatMessage[];
  serviceAccountEmail: string | null;
}) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="h-screen flex bg-ground">
      <ConversationSidebar gameId={game.id} gameName={game.name} conversations={conversations} selectedId={selectedId} sources={sources} onAddSource={() => setAddOpen(true)} />

      {sources.length > 0 ? (
        <ChatPane key={selectedId ?? "new"} gameId={game.id} conversationId={selectedId} initialMessages={messages} />
      ) : (
        <section className="flex-1 flex items-center justify-center" aria-label="대화">
          <div className="text-center flex flex-col items-center gap-3">
            <p className="text-sm text-muted">이 게임에 연결된 자료가 없습니다.</p>
            <button type="button" onClick={() => setAddOpen(true)} className="rounded-lg bg-accent text-white px-4 py-2 text-sm font-medium hover:opacity-90">
              자료 추가하기
            </button>
          </div>
        </section>
      )}

      {addOpen && <SourceAddDialog gameId={game.id} serviceAccountEmail={serviceAccountEmail} onClose={() => setAddOpen(false)} />}
    </div>
  );
}
```

`ProposalCard.tsx` 헤더의 `<span className="text-muted">{proposal.sheet}</span>` 앞에 `<span className="text-muted">{proposal.sourceTitle}</span><span className="text-muted">·</span>`를 넣는다.

`page.tsx`:
- import에 `import { listSources } from "@/lib/assistant-sources";` 추가.
- `const conversations = await listConversations(supabase, game.id);` → `const [conversations, sources] = await Promise.all([listConversations(supabase, game.id), listSources(supabase, game.id)]);`
- `<AssistantShell game={{ id: game.id, name: game.name }} sources={sources} …>`.

- [ ] **Step 10: 통과 확인**

Run: `npx vitest run tests/components && npx tsc --noEmit`
Expected: PASS. tsc에서 `sheetId` 관련 오류가 남으면 Task 9에서 정리한다.

- [ ] **Step 11: 커밋**

```bash
git add components/assistant "app/(assistant)/games/[gameId]/assistant/page.tsx" tests/components/ConversationSidebar.test.tsx tests/components/SourceAddDialog.test.tsx tests/components/AssistantShell.test.tsx
git commit -m "feat: sidebar lists linked sheets and docs with add/unlink"
```

---

### Task 9: `sheetId` 잔재 정리, 문서, 전체 검증

**Files:**
- Modify: `lib/categories.ts`
- Modify: 테스트 fixture 중 `sheetId`가 남은 파일(`grep -rn sheetId tests lib app components --include='*.ts' --include='*.tsx'`로 찾는다. 알려진 곳: `tests/components/GameRail.test.tsx`, `tests/components/InboxNav.test.tsx`, `tests/lib/inbox-page.test.ts`, `tests/lib/categories.test.ts`, `tests/api/inquiry-suggest.test.ts`)
- Modify: `CLAUDE.md`, `.env.example`
- Modify: `docs/superpowers/specs/2026-09-04-sheet-assistant-design.md` (머리말 한 줄)

- [ ] **Step 1: `GameRow.sheetId` 제거**

`lib/categories.ts`에서 `GameRow`의 `sheetId` 필드와 주석, `mapGameRow`의 `sheet_id?` 파라미터와 `sheetId: row.sheet_id ?? null` 줄을 지운다. `tests/lib/categories.test.ts`에서 `sheetId`/`sheet_id` 기대를 지운다. 나머지 테스트 fixture의 `sheetId: …` 속성도 지운다.

Run: `grep -rn "sheetId\|sheet_id" app lib components tests --include='*.ts' --include='*.tsx'`
Expected: 결과 없음(마이그레이션 SQL과 옛 스펙 문서만 남는다).

- [ ] **Step 2: 전체 검증**

Run: `npx vitest run && npx tsc --noEmit && npx next lint`
Expected: 모두 통과. 다른 세션의 미커밋 변경 때문에 실패하는 테스트가 있으면 그 파일이 무엇인지 사용자에게 보고하고 이 계획의 파일만 고친다.

- [ ] **Step 3: 문서 갱신**

`CLAUDE.md` 8번 항목을 다음으로 바꾼다:

```
8. **운영 시트 어시스턴트** — 문의함 보기 열의 "운영 어시스턴트 ↗"가 새 탭으로 `/games/{gameId}/assistant`를 연다(`app/(assistant)/`, 레일 없음). 게임에 연결한 구글 스프레드시트·구글 문서(`assistant_sources`, 사이드바의 "+ 자료 추가"에 URL 입력, 여러 개 가능, 마이그레이션 0017)를 서비스 계정(`GOOGLE_SERVICE_ACCOUNT_JSON`, 각 자료를 그 계정에 편집자로 공유)으로 매번 통째로 읽어 `# 시트: 제목`/`# 문서: 제목` 구간의 텍스트로 만들고 OpenAI(`OPENAI_API_KEY`, `OPENAI_MODEL` 기본 `gpt-5-mini`)에 시스템 프롬프트로 싣는다(`lib/assistant-sources.ts`, `lib/sheets.ts`, `lib/docs.ts`, `lib/assistant.ts`). 임베딩 검색은 쓰지 않고 자료 합계 30만 자까지다. 자료 제목은 등록 시 구글에서 읽어 저장하며, 공유가 안 돼 있으면 등록이 거절된다. "52009 VIP4로 올려줘" 같은 수정 요청은 모델이 `propose_update`/`propose_append` 도구(`spreadsheet` 인자로 시트 제목 지정)로 제안만 만들고, 서버가 자료·탭·열·행을 검증해 `sourceId`를 붙여 `assistant_messages`에 `pending`으로 저장하며, 관리자가 카드의 [적용]을 눌러야 그 시트를 다시 읽어 충돌을 확인한 뒤 Sheets API로 쓴다(마이그레이션 0015). 문서는 읽기 전용이고, 시트는 첫 줄이 열 이름인 탭만 수정할 수 있다. 대화는 게임별로 저장되고 ChatGPT식 사이드바에서 고른다(`?c=`). 설계는 `docs/superpowers/specs/2026-09-04-sheet-assistant-design.md`와 `docs/superpowers/specs/2026-09-07-assistant-sources-design.md`.
```

"운영 시트 어시스턴트 설정 절차"를 다음으로 바꾼다:

```
1. Google Cloud 콘솔 → 프로젝트 선택 → "Google Sheets API"와 "Google Docs API" 사용 설정 → IAM → 서비스 계정 만들기 → 키(JSON) 발급
2. 키 파일 내용을 한 줄로 만들어 `GOOGLE_SERVICE_ACCOUNT_JSON`에, OpenAI 키를 `OPENAI_API_KEY`에 넣고 재배포. Node 22 이상에서 실행한다(`openai` 패키지 요구사항; Vercel 프로젝트의 Node 버전을 확인)
3. Supabase SQL Editor에서 `0015_assistant.sql`, `0016_assistant_attachments.sql`, `0017_assistant_sources.sql`을 순서대로 실행. 0015는 anon의 games 조회를 열 단위로 제한한다 — 접수 폼은 id/name/logo_path만 읽는다. 0017은 기존 `games.sheet_id`를 자료 표로 옮기고 열을 지운다
4. 게임 운영 시트·문서를 만든다. 시트를 수정까지 쓰려면 탭 첫 줄에 열 이름을 둔다(예: VIP 탭 = 이메일 / ID / 서버 / 닉네임 / VIP 단계 / 갱신일)
5. 안내된 서비스 계정 이메일에 각 시트·문서를 편집자로 공유한 뒤, 관리자 페이지 → 게임 문의함 → "운영 어시스턴트" → 사이드바 "+ 자료 추가"에 URL을 넣는다
6. 시트는 "52009 VIP 몇이야"로 읽기, "52009 VIP4로 올려줘" → 제안 카드 → [적용] → 시트 반영 확인. 문서는 "환불 정책이 뭐야"처럼 물어 근거에 문서 이름이 붙는지 확인
```

`.env.example`의 주석을 "구글 시트를 읽고 쓰고 구글 문서를 읽는 서비스 계정 키(JSON 한 줄). 각 시트·문서를 이 계정의 client_email에 편집자로 공유한다"로.

`docs/superpowers/specs/2026-09-04-sheet-assistant-design.md` 맨 위 "작성일" 줄 아래에 추가: `시트 연결(games.sheet_id)·시트 설정 모달·PATCH /api/games/[gameId] 부분은 2026-09-07-assistant-sources-design.md로 대체됐다.`

- [ ] **Step 4: 커밋**

```bash
git add lib/categories.ts tests CLAUDE.md .env.example docs/superpowers/specs/2026-09-04-sheet-assistant-design.md
git commit -m "chore: drop games.sheetId leftovers and document assistant sources"
```

`git add tests`는 다른 세션의 미커밋 테스트 변경을 함께 담을 수 있다. 커밋 전 `git status`로 확인하고, 이 작업에서 고친 파일만 개별로 add한다.
