# 운영 시트 어시스턴트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 게임별 구글 시트를 근거로 자연어 질의에 답하고, 관리자가 확인한 뒤 시트를 수정하는 ChatGPT식 어시스턴트 화면을 `/games/{gameId}/assistant`에 만든다.

**Architecture:** 서비스 계정으로 시트 전체를 읽어 텍스트 표로 만든 뒤 OpenAI Chat Completions(스트리밍 + tool calling)에 시스템 프롬프트로 싣는다. 모델이 `propose_update`/`propose_append` 도구를 부르면 서버가 시트 구조와 대조해 검증한 제안을 `assistant_messages`에 `pending`으로 저장하고 NDJSON으로 흘리며, 관리자가 [적용]을 누르면 그 행을 다시 읽어 충돌을 확인하고 Sheets API로 쓴다. 대화·메시지는 Supabase에 저장한다.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind, Supabase(service role), `googleapis`(Sheets v4, JWT), `openai` SDK, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-04-sheet-assistant-design.md`

## Global Constraints

- 관리자 UI 문구는 한국어 전용. 코드 주석도 기존 파일처럼 한국어.
- 새 마이그레이션 번호는 `0015_assistant.sql`(`supabase/migrations/`). 실제 DB 적용은 사람이 SQL Editor에서 한다.
- 환경변수: `OPENAI_API_KEY`, `OPENAI_MODEL`(기본 `gpt-5-mini`), `GOOGLE_SERVICE_ACCOUNT_JSON`(한 줄 JSON). 비밀값은 `.env.local`에만.
- 시트 총량 한도 300,000자. 제안 종류는 `update`/`append` 둘뿐. 행 번호는 1-based(헤더 = 1행).
- 모든 API는 `requireAdminSession`/`getAdminSession`으로 보호. 실패 응답은 `{ success: false, error }`.
- 스트리밍 응답은 `app/api/inquiries/[id]/suggest/route.ts`와 같은 NDJSON(`application/x-ndjson; charset=utf-8`, `Cache-Control: no-cache, no-transform`).
- 작업 트리에 이 기능과 무관한 미커밋 변경(gmail·email-template 등)이 있다. **커밋할 때는 반드시 파일을 지정해 `git add`** 하고 `git add -A`는 쓰지 않는다.
- 테스트 실행: `npx vitest run <path>`. 전체: `npx vitest run`. 타입 확인: `npx tsc --noEmit`.
- 컴포넌트 테스트 파일 첫 줄에 `// @vitest-environment jsdom`.
- 커밋 메시지 끝에 다음 두 줄:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_012NxdwZEQRw3WsGLD3Gknys
  ```

## File Structure

| 파일 | 역할 |
|---|---|
| `supabase/migrations/0015_assistant.sql` | `games.sheet_id`, `assistant_conversations`, `assistant_messages` |
| `lib/categories.ts` (수정) | `GameRow.sheetId` 추가 |
| `lib/sheets.ts` | 서비스 계정 인증, 시트 읽기/직렬화/제안 검증/쓰기, URL 파싱. 순수 함수와 API 호출을 한 파일에 두되 순수 함수는 API 없이 테스트한다 |
| `lib/assistant.ts` | 시스템 프롬프트, 이력 변환, 도구 정의, OpenAI 스트리밍 → `AssistantEvent` |
| `lib/assistant-store.ts` | 대화·메시지 DB 접근 |
| `app/api/games/[gameId]/route.ts` (수정) | `PATCH` 추가: 시트 URL 저장 |
| `app/api/assistant/conversations/route.ts` | `POST` 대화 생성 |
| `app/api/assistant/conversations/[id]/route.ts` | `DELETE` |
| `app/api/assistant/conversations/[id]/messages/route.ts` | `POST` 메시지 전송(스트림) |
| `app/api/assistant/messages/[id]/apply/route.ts`, `.../cancel/route.ts` | 제안 적용/취소 |
| `app/(assistant)/games/[gameId]/assistant/page.tsx` | 서버 렌더 진입점(레일 없음) |
| `components/assistant/AssistantShell.tsx` | 사이드바 + 대화 영역 + 설정 모달 조립 |
| `components/assistant/ConversationSidebar.tsx` | 대화 목록·새 대화·삭제·시트 설정 버튼 |
| `components/assistant/ChatPane.tsx` | 메시지 상태, 전송, 스트림 소비 |
| `components/assistant/ProposalCard.tsx` | 제안 카드 + 적용/취소 |
| `components/assistant/SheetSettingsDialog.tsx` | 시트 URL 입력 모달 |
| `components/inbox/InboxNav.tsx` (수정) | "운영 어시스턴트 ↗" 링크 |
| `.env.example`, `CLAUDE.md`, `docs/PRD.md` (수정) | 설정·기능 문서 |

---

### Task 1: 마이그레이션, 환경변수, 패키지, `GameRow.sheetId`

**Files:**
- Create: `supabase/migrations/0015_assistant.sql`
- Modify: `.env.example`, `package.json`(`openai` 추가), `lib/categories.ts:4-11,160-175`
- Test: `tests/lib/categories.test.ts`

**Interfaces:**
- Produces: `GameRow.sheetId: string | null` (이후 모든 태스크가 `game.sheetId`로 읽는다)

- [ ] **Step 1: 마이그레이션 작성**

```sql
-- supabase/migrations/0015_assistant.sql
-- 운영 시트 어시스턴트: 게임별 시트 연결 + 대화/메시지 저장.

alter table games add column if not exists sheet_id text;

create table if not exists assistant_conversations (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references games(id) on delete cascade,
  title       text not null,
  created_by  text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists assistant_conversations_game_updated_idx
  on assistant_conversations (game_id, updated_at desc);

create table if not exists assistant_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references assistant_conversations(id) on delete cascade,
  role             text not null check (role in ('user', 'assistant', 'proposal')),
  content          text not null default '',
  proposal         jsonb,
  status           text check (status in ('pending', 'applied', 'cancelled', 'failed')),
  failure_reason   text,
  applied_by       text,
  applied_at       timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists assistant_messages_conversation_idx
  on assistant_messages (conversation_id, created_at);
```

- [ ] **Step 2: `.env.example`에 추가**

파일 끝에:

```
# 운영 시트 어시스턴트 (OpenAI)
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5-mini
# 구글 시트를 읽고 쓰는 서비스 계정 키(JSON 한 줄). 시트를 이 계정의 client_email에 편집자로 공유한다
GOOGLE_SERVICE_ACCOUNT_JSON=
```

- [ ] **Step 3: `openai` 설치**

Run: `npm install openai@^7`
Expected: `package.json` dependencies에 `"openai": "^7.x"` 추가, lockfile 갱신.

- [ ] **Step 4: 실패하는 테스트 — `GameRow`에 `sheetId`**

`tests/lib/categories.test.ts`에서 `listGames`를 검사하는 기존 describe를 찾아 다음 케이스를 추가한다(없으면 새 describe):

```ts
describe("listGames sheetId", () => {
  it("maps sheet_id to sheetId and defaults to null", async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        { id: "g1", name: "A", status: "active", logo_path: null, owner_name: null, created_at: "2026-01-01T00:00:00Z", sheet_id: "abc123" },
        { id: "g2", name: "B", status: "active", logo_path: null, owner_name: null, created_at: "2026-01-01T00:00:00Z", sheet_id: null },
      ],
      error: null,
    });
    const select = vi.fn(() => ({ order }));
    const from = vi.fn(() => ({ select }));

    const games = await listGames({ from } as never);

    expect(games[0].sheetId).toBe("abc123");
    expect(games[1].sheetId).toBeNull();
  });
});
```

- [ ] **Step 5: 실패 확인**

Run: `npx vitest run tests/lib/categories.test.ts`
Expected: FAIL — `sheetId`가 `undefined`.

- [ ] **Step 6: `lib/categories.ts` 수정**

`GameRow`에 `sheetId: string | null;` 추가. `mapGameRow`의 인자 타입에 `sheet_id?: string | null;`을 넣고 반환에 `sheetId: row.sheet_id ?? null,` 추가.

- [ ] **Step 7: 통과 확인 + 타입**

Run: `npx vitest run tests/lib/categories.test.ts && npx tsc --noEmit`
Expected: PASS. tsc에서 `GameRow` 리터럴을 만드는 테스트 파일(`tests/components/InboxNav.test.tsx`, `GameRail.test.tsx`, `tests/lib/inbox-page.test.ts` 등)이 `sheetId` 누락으로 실패하면 각 리터럴에 `sheetId: null`을 추가한다.

- [ ] **Step 8: 커밋**

```bash
git add supabase/migrations/0015_assistant.sql .env.example package.json package-lock.json lib/categories.ts tests/
git commit -m "feat: assistant schema, env, openai dependency, GameRow.sheetId"
```

---

### Task 2: `lib/sheets.ts` 순수 함수 — URL 파싱, 헤더 판정, 직렬화, A1, 제안 검증

**Files:**
- Create: `lib/sheets.ts`
- Test: `tests/lib/sheets.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SheetErrorReason = "not_configured" | "sheet_forbidden" | "sheet_not_found" | "sheet_too_large" | "sheet_read_failed" | "sheet_write_failed" | "invalid_proposal" | "conflict";
  export class SheetError extends Error { reason: SheetErrorReason }
  export interface SheetTab { title: string; header: string[] | null; rows: string[][] }
  export type Proposal =
    | { kind: "update"; sheet: string; row: number; updates: Array<{ column: string; before: string; after: string }> }
    | { kind: "append"; sheet: string; values: Record<string, string> };
  export const MAX_SHEET_CHARS = 300_000;
  export function parseSheetUrl(input: string): string | null;
  export function detectHeader(firstRow: string[] | undefined): string[] | null;
  export function serializeSheets(tabs: SheetTab[]): string;
  export function columnToA1(index: number): string;
  export function prepareProposal(tabs: SheetTab[], raw: unknown): Proposal | null;   // 모델 출력 검증 + before를 시트 값으로 채움
  export function validateProposal(tabs: SheetTab[], proposal: Proposal): { ok: true } | { ok: false; reason: "invalid_proposal" | "conflict" };
  ```

- [ ] **Step 1: 실패하는 테스트**

```ts
// tests/lib/sheets.test.ts
import { describe, it, expect } from "vitest";
import {
  parseSheetUrl,
  detectHeader,
  serializeSheets,
  columnToA1,
  prepareProposal,
  validateProposal,
  type SheetTab,
} from "@/lib/sheets";

const vip: SheetTab = {
  title: "VIP",
  header: ["이메일", "ID", "VIP 단계", "갱신일"],
  rows: [
    ["이메일", "ID", "VIP 단계", "갱신일"],
    ["a@x.com", "52009", "VIP5", "08.27"],
    ["b@x.com", "51989", "VIP3", "08.27"],
  ],
};

const notes: SheetTab = {
  title: "메모",
  header: null,
  rows: [["코드 목록"], [], ["m6fu5sj", "사용"]],
};

describe("parseSheetUrl", () => {
  it("extracts the id from a full url", () => {
    expect(parseSheetUrl("https://docs.google.com/spreadsheets/d/1AbC-_9/edit#gid=0")).toBe("1AbC-_9");
  });
  it("accepts a bare id", () => {
    expect(parseSheetUrl("  1AbC-_9 ")).toBe("1AbC-_9");
  });
  it("rejects other urls and empty input", () => {
    expect(parseSheetUrl("https://example.com/x")).toBeNull();
    expect(parseSheetUrl("")).toBeNull();
    expect(parseSheetUrl("a b")).toBeNull();
  });
});

describe("detectHeader", () => {
  it("uses the first row when every cell is non-empty and unique", () => {
    expect(detectHeader(["이메일", "ID"])).toEqual(["이메일", "ID"]);
  });
  it("returns null for empty, blank, or duplicate cells", () => {
    expect(detectHeader(undefined)).toBeNull();
    expect(detectHeader([])).toBeNull();
    expect(detectHeader(["이메일", ""])).toBeNull();
    expect(detectHeader(["ID", "ID"])).toBeNull();
  });
});

describe("serializeSheets", () => {
  it("renders header tabs as pipe tables with 1-based row numbers", () => {
    const text = serializeSheets([vip]);
    expect(text).toContain("## VIP");
    expect(text).toContain("행 | 이메일 | ID | VIP 단계 | 갱신일");
    expect(text).toContain("2 | a@x.com | 52009 | VIP5 | 08.27");
    expect(text).toContain("3 | b@x.com | 51989 | VIP3 | 08.27");
    expect(text).not.toContain("1 | 이메일");
  });
  it("renders header-less tabs as 행 | 내용 and skips blank rows", () => {
    const text = serializeSheets([notes]);
    expect(text).toContain("행 | 내용");
    expect(text).toContain("1 | 코드 목록");
    expect(text).toContain("3 | m6fu5sj 사용");
    expect(text).not.toContain("\n2 |");
  });
  it("replaces pipes and newlines inside cells", () => {
    const text = serializeSheets([{ title: "T", header: null, rows: [["a|b\nc"]] }]);
    expect(text).toContain("1 | a b c");
  });
});

describe("columnToA1", () => {
  it("converts 0-based indexes", () => {
    expect(columnToA1(0)).toBe("A");
    expect(columnToA1(25)).toBe("Z");
    expect(columnToA1(26)).toBe("AA");
    expect(columnToA1(27)).toBe("AB");
  });
});

describe("prepareProposal", () => {
  it("fills before from the sheet for a valid update", () => {
    const result = prepareProposal([vip], {
      kind: "update",
      sheet: "VIP",
      row: 3,
      updates: [{ column: "VIP 단계", before: "wrong", after: "VIP4" }],
    });
    expect(result).toEqual({
      kind: "update",
      sheet: "VIP",
      row: 3,
      updates: [{ column: "VIP 단계", before: "VIP3", after: "VIP4" }],
    });
  });
  it("rejects unknown tab, header-less tab, unknown column, bad row, empty updates", () => {
    const base = { kind: "update", sheet: "VIP", row: 2, updates: [{ column: "VIP 단계", before: "", after: "x" }] };
    expect(prepareProposal([vip], { ...base, sheet: "없음" })).toBeNull();
    expect(prepareProposal([vip, notes], { ...base, sheet: "메모" })).toBeNull();
    expect(prepareProposal([vip], { ...base, updates: [{ column: "없는열", before: "", after: "x" }] })).toBeNull();
    expect(prepareProposal([vip], { ...base, row: 1 })).toBeNull();
    expect(prepareProposal([vip], { ...base, row: 4 })).toBeNull();
    expect(prepareProposal([vip], { ...base, updates: [] })).toBeNull();
    expect(prepareProposal([vip], null)).toBeNull();
    expect(prepareProposal([vip], { kind: "delete" })).toBeNull();
  });
  it("accepts append with known columns only", () => {
    expect(prepareProposal([vip], { kind: "append", sheet: "VIP", values: { 이메일: "c@x.com", ID: "1" } })).toEqual({
      kind: "append",
      sheet: "VIP",
      values: { 이메일: "c@x.com", ID: "1" },
    });
    expect(prepareProposal([vip], { kind: "append", sheet: "VIP", values: { 없는열: "x" } })).toBeNull();
    expect(prepareProposal([vip], { kind: "append", sheet: "VIP", values: {} })).toBeNull();
  });
  it("coerces numeric values to strings", () => {
    const result = prepareProposal([vip], { kind: "append", sheet: "VIP", values: { ID: 52009 } });
    expect(result).toEqual({ kind: "append", sheet: "VIP", values: { ID: "52009" } });
  });
});

describe("validateProposal", () => {
  it("passes when the sheet still matches before", () => {
    expect(
      validateProposal([vip], { kind: "update", sheet: "VIP", row: 2, updates: [{ column: "VIP 단계", before: " VIP5 ", after: "VIP6" }] })
    ).toEqual({ ok: true });
  });
  it("reports conflict when the cell changed", () => {
    expect(
      validateProposal([vip], { kind: "update", sheet: "VIP", row: 2, updates: [{ column: "VIP 단계", before: "VIP4", after: "VIP6" }] })
    ).toEqual({ ok: false, reason: "conflict" });
  });
  it("reports invalid_proposal for structural problems", () => {
    expect(validateProposal([vip], { kind: "append", sheet: "메모", values: { a: "b" } })).toEqual({ ok: false, reason: "invalid_proposal" });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/lib/sheets.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

```ts
// lib/sheets.ts
/**
 * 운영 시트 어시스턴트의 구글 시트 연동.
 *
 * 순수 함수(파싱·직렬화·검증)와 Sheets API 호출을 한 파일에 두되, 전자는 API
 * 없이 테스트한다. 검색 방식을 임베딩으로 바꾸게 되더라도 이 파일만 바꾼다.
 */
import { google, type sheets_v4 } from "googleapis";

export type SheetErrorReason =
  | "not_configured"
  | "sheet_forbidden"
  | "sheet_not_found"
  | "sheet_too_large"
  | "sheet_read_failed"
  | "sheet_write_failed"
  | "invalid_proposal"
  | "conflict";

export class SheetError extends Error {
  constructor(
    public readonly reason: SheetErrorReason,
    message?: string
  ) {
    super(message ?? reason);
    this.name = "SheetError";
  }
}

/** rows[i]는 시트의 i+1행. 헤더가 있으면 rows[0]이 헤더다. */
export interface SheetTab {
  title: string;
  header: string[] | null;
  rows: string[][];
}

export type ProposalUpdate = { column: string; before: string; after: string };

export type Proposal =
  | { kind: "update"; sheet: string; row: number; updates: ProposalUpdate[] }
  | { kind: "append"; sheet: string; values: Record<string, string> };

export const MAX_SHEET_CHARS = 300_000;

const SHEET_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** 전체 URL이든 ID만이든 스프레드시트 ID를 돌려준다. 못 찾으면 null. */
export function parseSheetUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (match) return match[1];
  return SHEET_ID_PATTERN.test(trimmed) ? trimmed : null;
}

/** 첫 행의 모든 칸이 비어 있지 않고 서로 다르면 열 이름으로 본다. */
export function detectHeader(firstRow: string[] | undefined): string[] | null {
  if (!firstRow || firstRow.length === 0) return null;
  const cells = firstRow.map((cell) => cell.trim());
  if (cells.some((cell) => cell === "")) return null;
  if (new Set(cells).size !== cells.length) return null;
  return cells;
}

function cleanCell(cell: string): string {
  return cell.replace(/[|\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

/** 모델에 넘길 텍스트 표. 행 번호를 붙여야 수정 대상을 정확히 지목한다. */
export function serializeSheets(tabs: SheetTab[]): string {
  const blocks: string[] = [];
  for (const tab of tabs) {
    const lines: string[] = [`## ${tab.title}`];
    if (tab.header) {
      lines.push(["행", ...tab.header.map(cleanCell)].join(" | "));
      tab.rows.forEach((row, index) => {
        if (index === 0) return;
        if (row.every((cell) => cell.trim() === "")) return;
        const cells = tab.header!.map((_, col) => cleanCell(row[col] ?? ""));
        lines.push([String(index + 1), ...cells].join(" | "));
      });
    } else {
      lines.push("행 | 내용");
      tab.rows.forEach((row, index) => {
        const joined = cleanCell(row.join(" "));
        if (!joined) return;
        lines.push(`${index + 1} | ${joined}`);
      });
    }
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}

/** 0 → A, 25 → Z, 26 → AA */
export function columnToA1(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function findEditableTab(tabs: SheetTab[], title: unknown): (SheetTab & { header: string[] }) | null {
  if (typeof title !== "string") return null;
  const tab = tabs.find((entry) => entry.title === title);
  if (!tab || !tab.header) return null;
  return tab as SheetTab & { header: string[] };
}

function toCellString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

/**
 * 모델이 도구로 내놓은 값을 검증해 Proposal로 만든다. 탭·열·행이 시트에 있어야
 * 하고, update의 before는 모델이 적은 값 대신 시트의 현재 값으로 채운다(모델이
 * 잘못 옮겨 적어도 적용 시점의 충돌 검사가 의미 있게).
 */
export function prepareProposal(tabs: SheetTab[], raw: unknown): Proposal | null {
  if (typeof raw !== "object" || raw === null) return null;
  const input = raw as Record<string, unknown>;
  const tab = findEditableTab(tabs, input.sheet);
  if (!tab) return null;

  if (input.kind === "update") {
    const row = input.row;
    if (typeof row !== "number" || !Number.isInteger(row) || row < 2 || row > tab.rows.length) return null;
    if (!Array.isArray(input.updates) || input.updates.length === 0) return null;
    const updates: ProposalUpdate[] = [];
    for (const entry of input.updates as unknown[]) {
      if (typeof entry !== "object" || entry === null) return null;
      const { column, after } = entry as Record<string, unknown>;
      const col = typeof column === "string" ? tab.header.indexOf(column) : -1;
      const afterText = toCellString(after);
      if (col < 0 || afterText === null) return null;
      updates.push({ column: column as string, before: tab.rows[row - 1]?.[col] ?? "", after: afterText });
    }
    return { kind: "update", sheet: tab.title, row, updates };
  }

  if (input.kind === "append") {
    if (typeof input.values !== "object" || input.values === null) return null;
    const values: Record<string, string> = {};
    for (const [column, value] of Object.entries(input.values as Record<string, unknown>)) {
      const text = toCellString(value);
      if (!tab.header.includes(column) || text === null) return null;
      values[column] = text;
    }
    if (Object.keys(values).length === 0) return null;
    return { kind: "append", sheet: tab.title, values };
  }

  return null;
}

/** 적용 직전 검사. 구조가 어긋나면 invalid_proposal, 셀 값이 그 사이 바뀌었으면 conflict. */
export function validateProposal(tabs: SheetTab[], proposal: Proposal): { ok: true } | { ok: false; reason: "invalid_proposal" | "conflict" } {
  const tab = findEditableTab(tabs, proposal.sheet);
  if (!tab) return { ok: false, reason: "invalid_proposal" };

  if (proposal.kind === "update") {
    if (proposal.row < 2 || proposal.row > tab.rows.length || proposal.updates.length === 0) {
      return { ok: false, reason: "invalid_proposal" };
    }
    for (const update of proposal.updates) {
      const col = tab.header.indexOf(update.column);
      if (col < 0) return { ok: false, reason: "invalid_proposal" };
      const current = (tab.rows[proposal.row - 1]?.[col] ?? "").trim();
      if (current !== update.before.trim()) return { ok: false, reason: "conflict" };
    }
    return { ok: true };
  }

  const keys = Object.keys(proposal.values);
  if (keys.length === 0 || keys.some((key) => !tab.header.includes(key))) {
    return { ok: false, reason: "invalid_proposal" };
  }
  return { ok: true };
}

// ---- Sheets API (Task 3에서 채운다) ----
export type SheetsClient = sheets_v4.Sheets;
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/lib/sheets.test.ts`
Expected: PASS (모든 케이스).

- [ ] **Step 5: 커밋**

```bash
git add lib/sheets.ts tests/lib/sheets.test.ts
git commit -m "feat: sheet parsing, serialization, and proposal validation for the assistant"
```

---

### Task 3: `lib/sheets.ts` Sheets API — 인증, 읽기, 쓰기

**Files:**
- Modify: `lib/sheets.ts` (끝부분에 추가)
- Test: `tests/lib/sheets.test.ts` (추가)

**Interfaces:**
- Produces:
  ```ts
  export function serviceAccountEmail(): string | null;
  export async function readSpreadsheet(sheetId: string): Promise<SheetTab[]>;   // SheetError throw
  export async function applyProposal(sheetId: string, proposal: Proposal): Promise<void>;   // SheetError throw
  ```

- [ ] **Step 1: 실패하는 테스트 추가**

`tests/lib/sheets.test.ts` 맨 위 import 아래에 mock을 추가하고 describe들을 덧붙인다:

```ts
import { vi, beforeEach, afterEach } from "vitest";
import { readSpreadsheet, applyProposal, serviceAccountEmail, SheetError } from "@/lib/sheets";

const getMock = vi.fn();
const batchGetMock = vi.fn();
const batchUpdateMock = vi.fn();
const appendMock = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    auth: { JWT: vi.fn(function () { return {}; }) },
    sheets: vi.fn(() => ({
      spreadsheets: {
        get: getMock,
        values: { batchGet: batchGetMock, batchUpdate: batchUpdateMock, append: appendMock },
      },
    })),
  },
}));

const CREDS = JSON.stringify({ client_email: "bot@proj.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n" });

describe("service account", () => {
  afterEach(() => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  });
  it("returns the client_email, or null when unset or malformed", () => {
    expect(serviceAccountEmail()).toBeNull();
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = "{not json";
    expect(serviceAccountEmail()).toBeNull();
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = CREDS;
    expect(serviceAccountEmail()).toBe("bot@proj.iam.gserviceaccount.com");
  });
  it("readSpreadsheet throws not_configured without credentials", async () => {
    await expect(readSpreadsheet("s1")).rejects.toMatchObject({ reason: "not_configured" });
  });
});

describe("readSpreadsheet", () => {
  beforeEach(() => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = CREDS;
    getMock.mockReset();
    batchGetMock.mockReset();
  });
  afterEach(() => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  });

  it("reads every tab in one batchGet and detects headers", async () => {
    getMock.mockResolvedValue({ data: { sheets: [{ properties: { title: "VIP" } }, { properties: { title: "메모" } }] } });
    batchGetMock.mockResolvedValue({
      data: {
        valueRanges: [
          { values: [["이메일", "ID"], ["a@x.com", 52009]] },
          { values: [["코드 목록", ""], ["m6fu5sj"]] },
        ],
      },
    });

    const tabs = await readSpreadsheet("s1");

    expect(getMock).toHaveBeenCalledWith({ spreadsheetId: "s1", fields: "sheets.properties.title" });
    expect(batchGetMock).toHaveBeenCalledWith({ spreadsheetId: "s1", ranges: ["'VIP'", "'메모'"] });
    expect(tabs).toEqual([
      { title: "VIP", header: ["이메일", "ID"], rows: [["이메일", "ID"], ["a@x.com", "52009"]] },
      { title: "메모", header: null, rows: [["코드 목록", ""], ["m6fu5sj"]] },
    ]);
  });

  it("returns an empty list for a spreadsheet without tabs", async () => {
    getMock.mockResolvedValue({ data: { sheets: [] } });
    expect(await readSpreadsheet("s1")).toEqual([]);
    expect(batchGetMock).not.toHaveBeenCalled();
  });

  it("maps 403/404 and other failures to reasons", async () => {
    getMock.mockRejectedValueOnce({ code: 403 });
    await expect(readSpreadsheet("s1")).rejects.toMatchObject({ reason: "sheet_forbidden" });
    getMock.mockRejectedValueOnce({ code: 404 });
    await expect(readSpreadsheet("s1")).rejects.toMatchObject({ reason: "sheet_not_found" });
    getMock.mockRejectedValueOnce(new Error("boom"));
    await expect(readSpreadsheet("s1")).rejects.toMatchObject({ reason: "sheet_read_failed" });
  });

  it("throws sheet_too_large past the cap", async () => {
    getMock.mockResolvedValue({ data: { sheets: [{ properties: { title: "T" } }] } });
    batchGetMock.mockResolvedValue({ data: { valueRanges: [{ values: [["x".repeat(300_001)]] }] } });
    await expect(readSpreadsheet("s1")).rejects.toMatchObject({ reason: "sheet_too_large" });
  });
});

describe("applyProposal", () => {
  beforeEach(() => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = CREDS;
    getMock.mockReset().mockResolvedValue({ data: { sheets: [{ properties: { title: "VIP" } }] } });
    batchGetMock.mockReset().mockResolvedValue({
      data: { valueRanges: [{ values: [["이메일", "ID", "VIP 단계", "갱신일"], ["a@x.com", "52009", "VIP5", "08.27"]] }] },
    });
    batchUpdateMock.mockReset().mockResolvedValue({});
    appendMock.mockReset().mockResolvedValue({});
  });
  afterEach(() => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  });

  it("writes each updated cell by A1 range", async () => {
    await applyProposal("s1", {
      kind: "update",
      sheet: "VIP",
      row: 2,
      updates: [
        { column: "VIP 단계", before: "VIP5", after: "VIP6" },
        { column: "갱신일", before: "08.27", after: "09.04" },
      ],
    });
    expect(batchUpdateMock).toHaveBeenCalledWith({
      spreadsheetId: "s1",
      requestBody: {
        valueInputOption: "RAW",
        data: [
          { range: "'VIP'!C2", values: [["VIP6"]] },
          { range: "'VIP'!D2", values: [["09.04"]] },
        ],
      },
    });
  });

  it("appends a row ordered by the header, blank for missing columns", async () => {
    await applyProposal("s1", { kind: "append", sheet: "VIP", values: { ID: "1", 이메일: "c@x.com" } });
    expect(appendMock).toHaveBeenCalledWith({
      spreadsheetId: "s1",
      range: "'VIP'!A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [["c@x.com", "1", "", ""]] },
    });
  });

  it("throws conflict when the sheet changed since the proposal", async () => {
    await expect(
      applyProposal("s1", { kind: "update", sheet: "VIP", row: 2, updates: [{ column: "VIP 단계", before: "VIP4", after: "VIP6" }] })
    ).rejects.toMatchObject({ reason: "conflict" });
    expect(batchUpdateMock).not.toHaveBeenCalled();
  });

  it("throws sheet_write_failed when the API rejects", async () => {
    batchUpdateMock.mockRejectedValue(new Error("quota"));
    await expect(
      applyProposal("s1", { kind: "update", sheet: "VIP", row: 2, updates: [{ column: "VIP 단계", before: "VIP5", after: "VIP6" }] })
    ).rejects.toBeInstanceOf(SheetError);
    await expect(
      applyProposal("s1", { kind: "update", sheet: "VIP", row: 2, updates: [{ column: "VIP 단계", before: "VIP5", after: "VIP6" }] })
    ).rejects.toMatchObject({ reason: "sheet_write_failed" });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/lib/sheets.test.ts`
Expected: FAIL — `readSpreadsheet` 등 export 없음.

- [ ] **Step 3: 구현 (`lib/sheets.ts` 끝의 `// ---- Sheets API` 자리에)**

```ts
// ---- Sheets API ----

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function loadServiceAccount(): ServiceAccount | null {
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

/** 설정 안내용. 관리자가 이 주소에 시트를 편집자로 공유해야 한다. */
export function serviceAccountEmail(): string | null {
  return loadServiceAccount()?.client_email ?? null;
}

function sheetsClient(): sheets_v4.Sheets {
  const account = loadServiceAccount();
  if (!account) throw new SheetError("not_configured");
  const auth = new google.auth.JWT({
    email: account.client_email,
    key: account.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

function quoteTab(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { code, status } = error as { code?: unknown; status?: unknown };
  if (typeof code === "number") return code;
  if (typeof status === "number") return status;
  return undefined;
}

/** 모든 탭을 한 번의 batchGet으로 읽는다. 캐시 없음 — 항상 최신 시트 기준. */
export async function readSpreadsheet(sheetId: string): Promise<SheetTab[]> {
  const sheets = sheetsClient();
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: "sheets.properties.title" });
    const titles = (meta.data.sheets ?? [])
      .map((sheet) => sheet.properties?.title)
      .filter((title): title is string => typeof title === "string" && title.length > 0);
    if (titles.length === 0) return [];

    const values = await sheets.spreadsheets.values.batchGet({ spreadsheetId: sheetId, ranges: titles.map(quoteTab) });
    const ranges = values.data.valueRanges ?? [];

    let total = 0;
    const tabs = titles.map((title, index) => {
      const rows = (ranges[index]?.values ?? []).map((row) =>
        (row as unknown[]).map((cell) => {
          const text = cell === null || cell === undefined ? "" : String(cell);
          total += text.length;
          return text;
        })
      );
      return { title, header: detectHeader(rows[0]), rows };
    });

    if (total > MAX_SHEET_CHARS) throw new SheetError("sheet_too_large");
    return tabs;
  } catch (error) {
    if (error instanceof SheetError) throw error;
    const status = statusOf(error);
    if (status === 403) throw new SheetError("sheet_forbidden");
    if (status === 404) throw new SheetError("sheet_not_found");
    console.warn("[sheets] read failed", error);
    throw new SheetError("sheet_read_failed");
  }
}

/** 적용 직전에 다시 읽어 충돌을 확인한 뒤 쓴다. */
export async function applyProposal(sheetId: string, proposal: Proposal): Promise<void> {
  const tabs = await readSpreadsheet(sheetId);
  const verdict = validateProposal(tabs, proposal);
  if (!verdict.ok) throw new SheetError(verdict.reason);

  const tab = tabs.find((entry) => entry.title === proposal.sheet) as SheetTab & { header: string[] };
  const sheets = sheetsClient();
  try {
    if (proposal.kind === "update") {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: proposal.updates.map((update) => ({
            range: `${quoteTab(tab.title)}!${columnToA1(tab.header.indexOf(update.column))}${proposal.row}`,
            values: [[update.after]],
          })),
        },
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: `${quoteTab(tab.title)}!A1`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [tab.header.map((column) => proposal.values[column] ?? "")] },
      });
    }
  } catch (error) {
    console.warn("[sheets] write failed", error);
    throw new SheetError("sheet_write_failed");
  }
}
```

`export type SheetsClient` 줄은 지운다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/lib/sheets.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add lib/sheets.ts tests/lib/sheets.test.ts
git commit -m "feat: read and write game operation sheets with a service account"
```

---

### Task 4: `lib/assistant.ts` — 프롬프트, 이력 변환, OpenAI 스트리밍

**Files:**
- Create: `lib/assistant.ts`
- Test: `tests/lib/assistant.test.ts`

**Interfaces:**
- Consumes: `Proposal`, `SheetTab`, `SheetErrorReason`, `prepareProposal` from `lib/sheets.ts`
- Produces:
  ```ts
  export type AssistantErrorReason = SheetErrorReason | "model_failed";
  export type AssistantEvent =
    | { type: "text"; text: string }
    | { type: "proposal"; proposal: Proposal }
    | { type: "error"; reason: AssistantErrorReason };
  export type ProposalStatus = "pending" | "applied" | "cancelled" | "failed";
  export interface HistoryMessage { role: "user" | "assistant" | "proposal"; content: string; proposal: Proposal | null; status: ProposalStatus | null }
  export const HISTORY_LIMIT = 20;
  export function formatToday(date?: Date): string;                 // "09.04"
  export function buildAssistantPrompt(input: { gameName: string; today: string; sheetText: string }): string;
  export function describeProposal(proposal: Proposal, status: ProposalStatus | null): string;
  export function historyToMessages(history: HistoryMessage[]): Array<{ role: "user" | "assistant"; content: string }>;
  export function streamAssistant(input: { system: string; history: HistoryMessage[]; tabs: SheetTab[] }): AsyncGenerator<AssistantEvent>;
  ```

- [ ] **Step 1: 실패하는 테스트**

```ts
// tests/lib/assistant.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildAssistantPrompt,
  describeProposal,
  historyToMessages,
  formatToday,
  streamAssistant,
  type AssistantEvent,
  type HistoryMessage,
} from "@/lib/assistant";
import type { SheetTab } from "@/lib/sheets";

const createMock = vi.fn();
vi.mock("openai", () => ({
  default: vi.fn(function () {
    return { chat: { completions: { create: createMock } } };
  }),
}));

const vip: SheetTab = {
  title: "VIP",
  header: ["이메일", "VIP 단계"],
  rows: [["이메일", "VIP 단계"], ["a@x.com", "VIP3"]],
};

async function collect(events: AsyncGenerator<AssistantEvent>) {
  const out: AssistantEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

function chunks(...deltas: Array<Record<string, unknown>>) {
  return (async function* () {
    for (const delta of deltas) yield { choices: [{ delta }] };
  })();
}

describe("formatToday", () => {
  it("formats as MM.DD", () => {
    expect(formatToday(new Date(2026, 8, 4))).toBe("09.04");
  });
});

describe("buildAssistantPrompt", () => {
  it("includes the rules, game, date, and sheet text", () => {
    const system = buildAssistantPrompt({ gameName: "여신 키우기", today: "09.04", sheetText: "## VIP\n행 | 이메일" });
    expect(system).toContain("여신 키우기");
    expect(system).toContain("09.04");
    expect(system).toContain("한국어");
    expect(system).toContain("propose_update");
    expect(system).toContain("propose_append");
    expect(system).toContain("찾지 못했습니다");
    expect(system).toContain("되묻");
    expect(system).toContain("# 시트 내용");
    expect(system).toContain("## VIP");
  });
});

describe("describeProposal", () => {
  it("summarizes an update with its status", () => {
    const text = describeProposal(
      { kind: "update", sheet: "VIP", row: 7, updates: [{ column: "VIP 단계", before: "VIP3", after: "VIP4" }] },
      "applied"
    );
    expect(text).toBe("시트 수정 제안: VIP 탭 7행 VIP 단계 'VIP3' → 'VIP4' (적용됨)");
  });
  it("summarizes an append and other statuses", () => {
    const proposal = { kind: "append" as const, sheet: "VIP", values: { 이메일: "c@x.com", "VIP 단계": "VIP1" } };
    expect(describeProposal(proposal, "pending")).toBe("시트 수정 제안: VIP 탭에 행 추가 이메일 'c@x.com', VIP 단계 'VIP1' (대기)");
    expect(describeProposal(proposal, "cancelled")).toContain("(취소됨)");
    expect(describeProposal(proposal, "failed")).toContain("(실패)");
    expect(describeProposal(proposal, null)).toContain("(대기)");
  });
});

describe("historyToMessages", () => {
  it("keeps user/assistant text and turns proposals into assistant summaries", () => {
    const history: HistoryMessage[] = [
      { role: "user", content: "VIP 올려줘", proposal: null, status: null },
      { role: "proposal", content: "", proposal: { kind: "update", sheet: "VIP", row: 2, updates: [{ column: "VIP 단계", before: "VIP3", after: "VIP4" }] }, status: "applied" },
      { role: "assistant", content: "네", proposal: null, status: null },
    ];
    expect(historyToMessages(history)).toEqual([
      { role: "user", content: "VIP 올려줘" },
      { role: "assistant", content: "시트 수정 제안: VIP 탭 2행 VIP 단계 'VIP3' → 'VIP4' (적용됨)" },
      { role: "assistant", content: "네" },
    ]);
  });
});

describe("streamAssistant", () => {
  beforeEach(() => {
    createMock.mockReset();
    process.env.OPENAI_API_KEY = "sk-test";
    delete process.env.OPENAI_MODEL;
  });
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  const history: HistoryMessage[] = [{ role: "user", content: "질문", proposal: null, status: null }];

  it("yields not_configured without an api key", async () => {
    delete process.env.OPENAI_API_KEY;
    const events = await collect(streamAssistant({ system: "s", history, tabs: [vip] }));
    expect(events).toEqual([{ type: "error", reason: "not_configured" }]);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("streams text deltas and sends system + history + tools", async () => {
    createMock.mockResolvedValue(chunks({ content: "안녕" }, { content: "하세요" }));
    const events = await collect(streamAssistant({ system: "SYS", history, tabs: [vip] }));
    expect(events).toEqual([
      { type: "text", text: "안녕" },
      { type: "text", text: "하세요" },
    ]);
    const args = createMock.mock.calls[0][0];
    expect(args.model).toBe("gpt-5-mini");
    expect(args.stream).toBe(true);
    expect(args.messages[0]).toEqual({ role: "system", content: "SYS" });
    expect(args.messages[1]).toEqual({ role: "user", content: "질문" });
    expect(args.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual(["propose_update", "propose_append"]);
  });

  it("uses OPENAI_MODEL when set", async () => {
    process.env.OPENAI_MODEL = "gpt-5";
    createMock.mockResolvedValue(chunks({ content: "x" }));
    await collect(streamAssistant({ system: "s", history, tabs: [vip] }));
    expect(createMock.mock.calls[0][0].model).toBe("gpt-5");
  });

  it("assembles tool call deltas into a validated proposal", async () => {
    createMock.mockResolvedValue(
      chunks(
        { tool_calls: [{ index: 0, function: { name: "propose_update", arguments: '{"sheet":"VIP","row":2,' } }] },
        { tool_calls: [{ index: 0, function: { arguments: '"updates":[{"column":"VIP 단계","before":"VIP3","after":"VIP4"}]}' } }] }
      )
    );
    const events = await collect(streamAssistant({ system: "s", history, tabs: [vip] }));
    expect(events).toEqual([
      { type: "proposal", proposal: { kind: "update", sheet: "VIP", row: 2, updates: [{ column: "VIP 단계", before: "VIP3", after: "VIP4" }] } },
    ]);
  });

  it("maps propose_append to an append proposal", async () => {
    createMock.mockResolvedValue(
      chunks({ tool_calls: [{ index: 0, function: { name: "propose_append", arguments: '{"sheet":"VIP","values":{"이메일":"c@x.com"}}' } }] })
    );
    const events = await collect(streamAssistant({ system: "s", history, tabs: [vip] }));
    expect(events).toEqual([{ type: "proposal", proposal: { kind: "append", sheet: "VIP", values: { 이메일: "c@x.com" } } }]);
  });

  it("yields invalid_proposal for bad tool output", async () => {
    createMock.mockResolvedValue(
      chunks({ tool_calls: [{ index: 0, function: { name: "propose_update", arguments: '{"sheet":"없음","row":2,"updates":[]}' } }] })
    );
    const events = await collect(streamAssistant({ system: "s", history, tabs: [vip] }));
    expect(events).toEqual([{ type: "error", reason: "invalid_proposal" }]);
  });

  it("yields invalid_proposal for unparsable arguments", async () => {
    createMock.mockResolvedValue(chunks({ tool_calls: [{ index: 0, function: { name: "propose_update", arguments: "{oops" } }] }));
    const events = await collect(streamAssistant({ system: "s", history, tabs: [vip] }));
    expect(events).toEqual([{ type: "error", reason: "invalid_proposal" }]);
  });

  it("yields model_failed when the request throws, keeping earlier text", async () => {
    createMock.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: "일부" } }] };
        throw new Error("network");
      })()
    );
    const events = await collect(streamAssistant({ system: "s", history, tabs: [vip] }));
    expect(events).toEqual([
      { type: "text", text: "일부" },
      { type: "error", reason: "model_failed" },
    ]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/lib/assistant.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

```ts
// lib/assistant.ts
/**
 * 운영 시트 어시스턴트의 모델 호출.
 *
 * 프롬프트 조립·이력 변환은 순수 함수로 두고, OpenAI 스트림은 AssistantEvent로
 * 바꿔 내보낸다. 도구 호출은 조각을 모아 스트림이 끝난 뒤 검증한다.
 */
import OpenAI from "openai";
import { prepareProposal, type Proposal, type SheetErrorReason, type SheetTab } from "@/lib/sheets";

export type AssistantErrorReason = SheetErrorReason | "model_failed";

export type AssistantEvent =
  | { type: "text"; text: string }
  | { type: "proposal"; proposal: Proposal }
  | { type: "error"; reason: AssistantErrorReason };

export type ProposalStatus = "pending" | "applied" | "cancelled" | "failed";

export interface HistoryMessage {
  role: "user" | "assistant" | "proposal";
  content: string;
  proposal: Proposal | null;
  status: ProposalStatus | null;
}

/** 모델에 넘기는 이력 길이. 시트가 프롬프트 대부분을 차지하므로 이력은 짧게. */
export const HISTORY_LIMIT = 20;

const DEFAULT_MODEL = "gpt-5-mini";

/** 시트의 날짜 열 관습("08.27")에 맞춘다. */
export function formatToday(date: Date = new Date()): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${mm}.${dd}`;
}

export function buildAssistantPrompt(input: { gameName: string; today: string; sheetText: string }): string {
  return [
    `당신은 게임 "${input.gameName}"의 운영 담당자를 돕는 어시스턴트입니다.`,
    "아래 시트 내용만 근거로 한국어로 답하세요.",
    "",
    "규칙:",
    '- 답할 때 근거가 된 탭과 행 번호를 짧게 덧붙이세요. 예: "VIP 탭 7행".',
    '- 시트에 없는 내용은 "시트에서 찾지 못했습니다"라고 말하고 추측하지 마세요.',
    "- 사용자가 시트를 바꾸자고 하면 본문으로 설명하지 말고 propose_update 또는 propose_append 도구를 부르세요.",
    "  row와 before는 표에서 본 값을 그대로 넣으세요. 첫 줄이 열 이름인 탭에서만 수정할 수 있습니다.",
    `- 갱신일·날짜 같은 열이 있으면 오늘 날짜(${input.today})도 함께 넣으세요.`,
    "- 대상 행이 여럿이거나 특정할 수 없으면 도구를 부르지 말고 어느 것인지 되묻으세요.",
    "- 표의 행 번호는 시트의 실제 행 번호입니다(1행이 열 이름).",
    "",
    `오늘 날짜: ${input.today}`,
    "",
    "# 시트 내용",
    "",
    input.sheetText,
  ].join("\n");
}

const STATUS_LABELS: Record<ProposalStatus, string> = {
  pending: "대기",
  applied: "적용됨",
  cancelled: "취소됨",
  failed: "실패",
};

/** 제안을 한 줄 텍스트로. 화면 요약과 모델 이력 양쪽에서 쓴다. */
export function describeProposal(proposal: Proposal, status: ProposalStatus | null): string {
  const suffix = ` (${STATUS_LABELS[status ?? "pending"]})`;
  if (proposal.kind === "update") {
    const changes = proposal.updates.map((update) => `${update.column} '${update.before}' → '${update.after}'`).join(", ");
    return `시트 수정 제안: ${proposal.sheet} 탭 ${proposal.row}행 ${changes}${suffix}`;
  }
  const values = Object.entries(proposal.values)
    .map(([column, value]) => `${column} '${value}'`)
    .join(", ");
  return `시트 수정 제안: ${proposal.sheet} 탭에 행 추가 ${values}${suffix}`;
}

export function historyToMessages(history: HistoryMessage[]): Array<{ role: "user" | "assistant"; content: string }> {
  return history.map((message) => {
    if (message.role === "proposal" && message.proposal) {
      return { role: "assistant" as const, content: describeProposal(message.proposal, message.status) };
    }
    return { role: message.role === "user" ? ("user" as const) : ("assistant" as const), content: message.content };
  });
}

const PROPOSAL_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "propose_update",
      description: "시트의 한 행에서 몇 개 열의 값을 바꾸자고 제안한다. 관리자가 확인한 뒤에만 적용된다.",
      parameters: {
        type: "object",
        properties: {
          sheet: { type: "string", description: "탭 이름" },
          row: { type: "integer", description: "표에 적힌 행 번호(1행은 열 이름)" },
          updates: {
            type: "array",
            items: {
              type: "object",
              properties: {
                column: { type: "string", description: "열 이름" },
                before: { type: "string", description: "표에서 본 현재 값" },
                after: { type: "string", description: "바꿀 값" },
              },
              required: ["column", "before", "after"],
            },
          },
        },
        required: ["sheet", "row", "updates"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_append",
      description: "시트 탭 끝에 한 행을 추가하자고 제안한다. 관리자가 확인한 뒤에만 적용된다.",
      parameters: {
        type: "object",
        properties: {
          sheet: { type: "string", description: "탭 이름" },
          values: { type: "object", description: "열 이름 → 값", additionalProperties: { type: "string" } },
        },
        required: ["sheet", "values"],
      },
    },
  },
];

function toolCallToRaw(name: string, args: string): unknown | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(args);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  if (name === "propose_update") return { kind: "update", ...(parsed as object) };
  if (name === "propose_append") return { kind: "append", ...(parsed as object) };
  return null;
}

export async function* streamAssistant(input: {
  system: string;
  history: HistoryMessage[];
  tabs: SheetTab[];
}): AsyncGenerator<AssistantEvent> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    yield { type: "error", reason: "not_configured" };
    return;
  }

  const client = new OpenAI({ apiKey });
  // tool call은 index별로 이름과 인자 조각이 따로 온다. 끝까지 모아야 파싱된다.
  const toolCalls = new Map<number, { name: string; args: string }>();

  try {
    const stream = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? DEFAULT_MODEL,
      stream: true,
      messages: [{ role: "system", content: input.system }, ...historyToMessages(input.history)],
      tools: PROPOSAL_TOOLS,
      tool_choice: "auto",
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        yield { type: "text", text: delta.content };
      }
      for (const call of delta.tool_calls ?? []) {
        const slot = toolCalls.get(call.index) ?? { name: "", args: "" };
        if (call.function?.name) slot.name = call.function.name;
        if (call.function?.arguments) slot.args += call.function.arguments;
        toolCalls.set(call.index, slot);
      }
    }
  } catch (error) {
    console.warn("[assistant] OpenAI request failed", error);
    yield { type: "error", reason: "model_failed" };
    return;
  }

  for (const call of toolCalls.values()) {
    const raw = toolCallToRaw(call.name, call.args);
    const proposal = raw ? prepareProposal(input.tabs, raw) : null;
    if (!proposal) {
      yield { type: "error", reason: "invalid_proposal" };
      return;
    }
    yield { type: "proposal", proposal };
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/lib/assistant.test.ts && npx tsc --noEmit`
Expected: PASS. (`ChatCompletionTool` 타입 경로가 설치된 `openai` 버전과 다르면 `import type { ChatCompletionTool } from "openai/resources/chat/completions"`로 바꾼다.)

- [ ] **Step 5: 커밋**

```bash
git add lib/assistant.ts tests/lib/assistant.test.ts
git commit -m "feat: assistant prompt, history, and OpenAI streaming with sheet proposals"
```

---

### Task 5: `lib/assistant-store.ts` — 대화·메시지 DB 접근

**Files:**
- Create: `lib/assistant-store.ts`
- Test: `tests/lib/assistant-store.test.ts`

**Interfaces:**
- Consumes: `Proposal` from `lib/sheets.ts`, `ProposalStatus`, `HistoryMessage` from `lib/assistant.ts`
- Produces:
  ```ts
  export interface ConversationRow { id: string; gameId: string; title: string; createdBy: string; createdAt: string; updatedAt: string }
  export interface MessageRow { id: string; conversationId: string; role: "user" | "assistant" | "proposal"; content: string; proposal: Proposal | null; status: ProposalStatus | null; failureReason: string | null; appliedBy: string | null; appliedAt: string | null; createdAt: string }
  export function conversationTitle(firstMessage: string): string;                // 앞 40자
  export async function listConversations(supabase, gameId): Promise<ConversationRow[]>;
  export async function getConversation(supabase, id): Promise<ConversationRow | null>;
  export async function createConversation(supabase, input: { gameId: string; title: string; createdBy: string }): Promise<ConversationRow | null>;
  export async function deleteConversation(supabase, id): Promise<boolean>;
  export async function touchConversation(supabase, id): Promise<void>;
  export async function listMessages(supabase, conversationId): Promise<MessageRow[]>;
  export async function getMessage(supabase, id): Promise<MessageRow | null>;
  export async function insertMessage(supabase, input: { conversationId: string; role: MessageRow["role"]; content?: string; proposal?: Proposal; status?: ProposalStatus }): Promise<MessageRow | null>;
  export async function updateProposalStatus(supabase, id, patch: { status: ProposalStatus; failureReason?: string | null; appliedBy?: string | null; appliedAt?: string | null }): Promise<boolean>;
  export function toHistory(messages: MessageRow[]): HistoryMessage[];        // 최근 HISTORY_LIMIT개
  ```

- [ ] **Step 1: 실패하는 테스트**

```ts
// tests/lib/assistant-store.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  conversationTitle,
  listConversations,
  createConversation,
  deleteConversation,
  listMessages,
  insertMessage,
  updateProposalStatus,
  toHistory,
  type MessageRow,
} from "@/lib/assistant-store";

const conversationRow = {
  id: "c1",
  game_id: "g1",
  title: "VIP 확인",
  created_by: "admin@theplayplus.com",
  created_at: "2026-09-04T01:00:00.000Z",
  updated_at: "2026-09-04T02:00:00.000Z",
};

const messageRow = {
  id: "m1",
  conversation_id: "c1",
  role: "proposal",
  content: "",
  proposal: { kind: "update", sheet: "VIP", row: 2, updates: [{ column: "VIP 단계", before: "VIP3", after: "VIP4" }] },
  status: "pending",
  failure_reason: null,
  applied_by: null,
  applied_at: null,
  created_at: "2026-09-04T01:01:00.000Z",
};

describe("conversationTitle", () => {
  it("trims and cuts to 40 characters", () => {
    expect(conversationTitle("  안녕  ")).toBe("안녕");
    expect(conversationTitle("가".repeat(50))).toHaveLength(40);
    expect(conversationTitle("   ")).toBe("새 대화");
  });
});

describe("listConversations", () => {
  it("filters by game and orders by updated_at desc", async () => {
    const order = vi.fn().mockResolvedValue({ data: [conversationRow], error: null });
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));

    const result = await listConversations({ from } as never, "g1");

    expect(from).toHaveBeenCalledWith("assistant_conversations");
    expect(eq).toHaveBeenCalledWith("game_id", "g1");
    expect(order).toHaveBeenCalledWith("updated_at", { ascending: false });
    expect(result).toEqual([
      { id: "c1", gameId: "g1", title: "VIP 확인", createdBy: "admin@theplayplus.com", createdAt: conversationRow.created_at, updatedAt: conversationRow.updated_at },
    ]);
  });
});

describe("createConversation", () => {
  it("inserts and returns the mapped row", async () => {
    const single = vi.fn().mockResolvedValue({ data: conversationRow, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const from = vi.fn(() => ({ insert }));

    const result = await createConversation({ from } as never, { gameId: "g1", title: "VIP 확인", createdBy: "admin@theplayplus.com" });

    expect(insert).toHaveBeenCalledWith({ game_id: "g1", title: "VIP 확인", created_by: "admin@theplayplus.com" });
    expect(result?.id).toBe("c1");
  });
  it("returns null on error", async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: "x" } });
    const from = vi.fn(() => ({ insert: () => ({ select: () => ({ single }) }) }));
    expect(await createConversation({ from } as never, { gameId: "g1", title: "t", createdBy: "a" })).toBeNull();
  });
});

describe("deleteConversation", () => {
  it("deletes by id", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn(() => ({ delete: () => ({ eq }) }));
    expect(await deleteConversation({ from } as never, "c1")).toBe(true);
    expect(eq).toHaveBeenCalledWith("id", "c1");
  });
});

describe("listMessages", () => {
  it("orders oldest first and maps proposal fields", async () => {
    const order = vi.fn().mockResolvedValue({ data: [messageRow], error: null });
    const eq = vi.fn(() => ({ order }));
    const from = vi.fn(() => ({ select: () => ({ eq }) }));

    const result = await listMessages({ from } as never, "c1");

    expect(eq).toHaveBeenCalledWith("conversation_id", "c1");
    expect(order).toHaveBeenCalledWith("created_at", { ascending: true });
    expect(result[0]).toEqual({
      id: "m1",
      conversationId: "c1",
      role: "proposal",
      content: "",
      proposal: messageRow.proposal,
      status: "pending",
      failureReason: null,
      appliedBy: null,
      appliedAt: null,
      createdAt: messageRow.created_at,
    });
  });
});

describe("insertMessage", () => {
  it("writes proposal rows with pending status", async () => {
    const single = vi.fn().mockResolvedValue({ data: messageRow, error: null });
    const insert = vi.fn(() => ({ select: () => ({ single }) }));
    const from = vi.fn(() => ({ insert }));

    await insertMessage({ from } as never, { conversationId: "c1", role: "proposal", proposal: messageRow.proposal as never, status: "pending" });

    expect(insert).toHaveBeenCalledWith({
      conversation_id: "c1",
      role: "proposal",
      content: "",
      proposal: messageRow.proposal,
      status: "pending",
    });
  });
  it("writes text rows without proposal", async () => {
    const single = vi.fn().mockResolvedValue({ data: { ...messageRow, role: "user", content: "hi", proposal: null, status: null }, error: null });
    const insert = vi.fn(() => ({ select: () => ({ single }) }));
    const from = vi.fn(() => ({ insert }));

    await insertMessage({ from } as never, { conversationId: "c1", role: "user", content: "hi" });

    expect(insert).toHaveBeenCalledWith({ conversation_id: "c1", role: "user", content: "hi", proposal: null, status: null });
  });
});

describe("updateProposalStatus", () => {
  it("patches status and applied fields", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));

    const ok = await updateProposalStatus({ from } as never, "m1", { status: "applied", appliedBy: "a@b", appliedAt: "2026-09-04T03:00:00.000Z" });

    expect(ok).toBe(true);
    expect(update).toHaveBeenCalledWith({ status: "applied", failure_reason: null, applied_by: "a@b", applied_at: "2026-09-04T03:00:00.000Z" });
    expect(eq).toHaveBeenCalledWith("id", "m1");
  });
});

describe("toHistory", () => {
  it("keeps only the last 20 messages", () => {
    const messages: MessageRow[] = Array.from({ length: 25 }, (_, i) => ({
      id: `m${i}`,
      conversationId: "c1",
      role: "user",
      content: `q${i}`,
      proposal: null,
      status: null,
      failureReason: null,
      appliedBy: null,
      appliedAt: null,
      createdAt: "2026-09-04T00:00:00.000Z",
    }));
    const history = toHistory(messages);
    expect(history).toHaveLength(20);
    expect(history[0].content).toBe("q5");
    expect(history[19]).toEqual({ role: "user", content: "q24", proposal: null, status: null });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/lib/assistant-store.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

```ts
// lib/assistant-store.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Proposal } from "@/lib/sheets";
import { HISTORY_LIMIT, type HistoryMessage, type ProposalStatus } from "@/lib/assistant";

export interface ConversationRow {
  id: string;
  gameId: string;
  title: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type MessageRole = "user" | "assistant" | "proposal";

export interface MessageRow {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  proposal: Proposal | null;
  status: ProposalStatus | null;
  failureReason: string | null;
  appliedBy: string | null;
  appliedAt: string | null;
  createdAt: string;
}

const TITLE_LENGTH = 40;

export function conversationTitle(firstMessage: string): string {
  const trimmed = firstMessage.trim().replace(/\s+/g, " ");
  if (!trimmed) return "새 대화";
  return Array.from(trimmed).slice(0, TITLE_LENGTH).join("");
}

function mapConversation(row: {
  id: string;
  game_id: string;
  title: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}): ConversationRow {
  return { id: row.id, gameId: row.game_id, title: row.title, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapMessage(row: {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  proposal: Proposal | null;
  status: string | null;
  failure_reason: string | null;
  applied_by: string | null;
  applied_at: string | null;
  created_at: string;
}): MessageRow {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as MessageRole,
    content: row.content,
    proposal: row.proposal,
    status: (row.status as ProposalStatus | null) ?? null,
    failureReason: row.failure_reason,
    appliedBy: row.applied_by,
    appliedAt: row.applied_at,
    createdAt: row.created_at,
  };
}

export async function listConversations(supabase: SupabaseClient, gameId: string): Promise<ConversationRow[]> {
  const { data, error } = await supabase
    .from("assistant_conversations")
    .select("*")
    .eq("game_id", gameId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Failed to list conversations: ${error.message}`);
  return (data ?? []).map(mapConversation);
}

export async function getConversation(supabase: SupabaseClient, id: string): Promise<ConversationRow | null> {
  const { data, error } = await supabase.from("assistant_conversations").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return mapConversation(data);
}

export async function createConversation(
  supabase: SupabaseClient,
  input: { gameId: string; title: string; createdBy: string }
): Promise<ConversationRow | null> {
  const { data, error } = await supabase
    .from("assistant_conversations")
    .insert({ game_id: input.gameId, title: input.title, created_by: input.createdBy })
    .select("*")
    .single();
  if (error || !data) return null;
  return mapConversation(data);
}

export async function deleteConversation(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { error } = await supabase.from("assistant_conversations").delete().eq("id", id);
  return !error;
}

/** 목록 정렬용. 메시지가 오갈 때마다 updated_at을 올린다. */
export async function touchConversation(supabase: SupabaseClient, id: string): Promise<void> {
  await supabase.from("assistant_conversations").update({ updated_at: new Date().toISOString() }).eq("id", id);
}

export async function listMessages(supabase: SupabaseClient, conversationId: string): Promise<MessageRow[]> {
  const { data, error } = await supabase
    .from("assistant_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Failed to list messages: ${error.message}`);
  return (data ?? []).map(mapMessage);
}

export async function getMessage(supabase: SupabaseClient, id: string): Promise<MessageRow | null> {
  const { data, error } = await supabase.from("assistant_messages").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return mapMessage(data);
}

export async function insertMessage(
  supabase: SupabaseClient,
  input: { conversationId: string; role: MessageRole; content?: string; proposal?: Proposal; status?: ProposalStatus }
): Promise<MessageRow | null> {
  const { data, error } = await supabase
    .from("assistant_messages")
    .insert({
      conversation_id: input.conversationId,
      role: input.role,
      content: input.content ?? "",
      proposal: input.proposal ?? null,
      status: input.status ?? null,
    })
    .select("*")
    .single();
  if (error || !data) return null;
  return mapMessage(data);
}

export async function updateProposalStatus(
  supabase: SupabaseClient,
  id: string,
  patch: { status: ProposalStatus; failureReason?: string | null; appliedBy?: string | null; appliedAt?: string | null }
): Promise<boolean> {
  const { error } = await supabase
    .from("assistant_messages")
    .update({
      status: patch.status,
      failure_reason: patch.failureReason ?? null,
      applied_by: patch.appliedBy ?? null,
      applied_at: patch.appliedAt ?? null,
    })
    .eq("id", id);
  return !error;
}

/** 모델에 넘길 이력. 최근 HISTORY_LIMIT개만. */
export function toHistory(messages: MessageRow[]): HistoryMessage[] {
  return messages.slice(-HISTORY_LIMIT).map((message) => ({
    role: message.role,
    content: message.content,
    proposal: message.proposal,
    status: message.status,
  }));
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/lib/assistant-store.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add lib/assistant-store.ts tests/lib/assistant-store.test.ts
git commit -m "feat: assistant conversation and message store"
```

---

### Task 6: `PATCH /api/games/[gameId]` — 시트 URL 저장

**Files:**
- Modify: `app/api/games/[gameId]/route.ts` (기존 `DELETE` 아래에 `PATCH` 추가)
- Test: `tests/api/game-sheet.test.ts`

**Interfaces:**
- Consumes: `parseSheetUrl`, `serviceAccountEmail` from `lib/sheets.ts`
- Produces: 요청 `{ sheetUrl: string }` → 응답 `{ success: true, sheetId: string, serviceAccountEmail: string | null }`. 오류: 401 `unauthorized`, 400 `invalid_input`, 404 `not_found`, 500 `save_failed`.

- [ ] **Step 1: 실패하는 테스트**

```ts
// tests/api/game-sheet.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PATCH } from "@/app/api/games/[gameId]/route";
import * as supabaseModule from "@/lib/supabase";
import * as sessionModule from "@/lib/require-admin-session";
import * as sheetsModule from "@/lib/sheets";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/require-admin-session", () => ({ requireAdminSession: vi.fn(), getAdminSession: vi.fn() }));
vi.mock("@/lib/sheets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sheets")>();
  return { ...actual, serviceAccountEmail: vi.fn(() => "bot@proj.iam.gserviceaccount.com") };
});

function request(body: unknown) {
  return new Request("http://localhost/api/games/g1", { method: "PATCH", body: JSON.stringify(body) });
}

function mockUpdate(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ single }));
  const eq = vi.fn(() => ({ select }));
  const update = vi.fn(() => ({ eq }));
  vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({ from: vi.fn(() => ({ update })) } as never);
  return { update, eq };
}

describe("PATCH /api/games/[gameId]", () => {
  beforeEach(() => {
    vi.mocked(sessionModule.requireAdminSession).mockReset().mockResolvedValue(true);
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReset();
  });

  it("returns 401 without a session", async () => {
    vi.mocked(sessionModule.requireAdminSession).mockResolvedValue(false);
    const response = await PATCH(request({ sheetUrl: "x" }), { params: { gameId: "g1" } });
    expect(response.status).toBe(401);
  });

  it("rejects an unparsable url", async () => {
    const response = await PATCH(request({ sheetUrl: "https://example.com" }), { params: { gameId: "g1" } });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: "invalid_input" });
  });

  it("stores the sheet id and returns the service account email", async () => {
    const { update, eq } = mockUpdate({ data: { id: "g1" }, error: null });
    const response = await PATCH(request({ sheetUrl: "https://docs.google.com/spreadsheets/d/1AbC/edit" }), { params: { gameId: "g1" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, sheetId: "1AbC", serviceAccountEmail: "bot@proj.iam.gserviceaccount.com" });
    expect(update).toHaveBeenCalledWith({ sheet_id: "1AbC" });
    expect(eq).toHaveBeenCalledWith("id", "g1");
  });

  it("returns 404 when the game does not exist", async () => {
    mockUpdate({ data: null, error: { code: "PGRST116", message: "no rows" } });
    const response = await PATCH(request({ sheetUrl: "1AbC" }), { params: { gameId: "g1" } });
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/api/game-sheet.test.ts`
Expected: FAIL — `PATCH` export 없음.

- [ ] **Step 3: 구현 (`app/api/games/[gameId]/route.ts` 끝에 추가, import에 `parseSheetUrl, serviceAccountEmail` 추가)**

```ts
import { parseSheetUrl, serviceAccountEmail } from "@/lib/sheets";

/** 운영 시트 연결. URL이나 ID를 받아 games.sheet_id에 저장한다. */
export async function PATCH(request: Request, { params }: { params: { gameId: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { sheetUrl?: unknown };
  try {
    body = (await request.json()) as { sheetUrl?: unknown };
  } catch {
    return NextResponse.json({ success: false, error: "invalid_input" }, { status: 400 });
  }

  const sheetId = typeof body.sheetUrl === "string" ? parseSheetUrl(body.sheetUrl) : null;
  if (!sheetId) {
    return NextResponse.json({ success: false, error: "invalid_input" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("games").update({ sheet_id: sheetId }).eq("id", params.gameId).select("id").single();

  if (error?.code === "PGRST116" || (!error && !data)) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }
  if (error) {
    return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true, sheetId, serviceAccountEmail: serviceAccountEmail() });
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/api/game-sheet.test.ts tests/api/game-delete.test.ts && npx tsc --noEmit`
Expected: PASS (기존 DELETE 테스트도 그대로 통과).

- [ ] **Step 5: 커밋**

```bash
git add app/api/games/[gameId]/route.ts tests/api/game-sheet.test.ts
git commit -m "feat: PATCH /api/games/[gameId] links a game to its operation sheet"
```

---

### Task 7: 대화 생성·삭제 라우트

**Files:**
- Create: `app/api/assistant/conversations/route.ts`, `app/api/assistant/conversations/[id]/route.ts`
- Test: `tests/api/assistant-conversations.test.ts`

**Interfaces:**
- Consumes: `createConversation`, `deleteConversation`, `conversationTitle` from `lib/assistant-store.ts`; `getAdminSession`
- Produces: `POST /api/assistant/conversations` `{ gameId, firstMessage }` → `{ success: true, conversationId }`. `DELETE /api/assistant/conversations/[id]` → `{ success: true }`.

- [ ] **Step 1: 실패하는 테스트**

```ts
// tests/api/assistant-conversations.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/assistant/conversations/route";
import { DELETE } from "@/app/api/assistant/conversations/[id]/route";
import * as supabaseModule from "@/lib/supabase";
import * as sessionModule from "@/lib/require-admin-session";
import * as storeModule from "@/lib/assistant-store";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn(() => ({})) }));
vi.mock("@/lib/require-admin-session", () => ({ requireAdminSession: vi.fn(), getAdminSession: vi.fn() }));
vi.mock("@/lib/assistant-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/assistant-store")>();
  return { ...actual, createConversation: vi.fn(), deleteConversation: vi.fn() };
});

const conversation = { id: "c1", gameId: "g1", title: "VIP 확인", createdBy: "a@b", createdAt: "", updatedAt: "" };

describe("POST /api/assistant/conversations", () => {
  beforeEach(() => {
    vi.mocked(sessionModule.getAdminSession).mockReset().mockResolvedValue({ id: "u1", email: "a@b" });
    vi.mocked(storeModule.createConversation).mockReset().mockResolvedValue(conversation);
  });

  function request(body: unknown) {
    return new Request("http://localhost/api/assistant/conversations", { method: "POST", body: JSON.stringify(body) });
  }

  it("returns 401 without a session", async () => {
    vi.mocked(sessionModule.getAdminSession).mockResolvedValue(null);
    expect((await POST(request({ gameId: "g1", firstMessage: "x" }))).status).toBe(401);
  });

  it("rejects a missing gameId", async () => {
    expect((await POST(request({ firstMessage: "x" }))).status).toBe(400);
  });

  it("creates a conversation titled from the first message", async () => {
    const response = await POST(request({ gameId: "g1", firstMessage: "  52009 VIP 몇이야  " }));
    expect(await response.json()).toEqual({ success: true, conversationId: "c1" });
    expect(storeModule.createConversation).toHaveBeenCalledWith(expect.anything(), { gameId: "g1", title: "52009 VIP 몇이야", createdBy: "a@b" });
  });

  it("returns 500 when the insert fails", async () => {
    vi.mocked(storeModule.createConversation).mockResolvedValue(null);
    expect((await POST(request({ gameId: "g1", firstMessage: "x" }))).status).toBe(500);
  });
});

describe("DELETE /api/assistant/conversations/[id]", () => {
  beforeEach(() => {
    vi.mocked(sessionModule.requireAdminSession).mockReset().mockResolvedValue(true);
    vi.mocked(storeModule.deleteConversation).mockReset().mockResolvedValue(true);
  });

  it("returns 401 without a session", async () => {
    vi.mocked(sessionModule.requireAdminSession).mockResolvedValue(false);
    const response = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), { params: { id: "c1" } });
    expect(response.status).toBe(401);
    expect(storeModule.deleteConversation).not.toHaveBeenCalled();
  });

  it("deletes and returns success", async () => {
    const response = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), { params: { id: "c1" } });
    expect(await response.json()).toEqual({ success: true });
    expect(storeModule.deleteConversation).toHaveBeenCalledWith(expect.anything(), "c1");
  });

  it("returns 500 when the delete fails", async () => {
    vi.mocked(storeModule.deleteConversation).mockResolvedValue(false);
    const response = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), { params: { id: "c1" } });
    expect(response.status).toBe(500);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/api/assistant-conversations.test.ts`
Expected: FAIL — 라우트 모듈 없음.

- [ ] **Step 3: 구현**

```ts
// app/api/assistant/conversations/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { getAdminSession } from "@/lib/require-admin-session";
import { conversationTitle, createConversation } from "@/lib/assistant-store";

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { gameId?: unknown; firstMessage?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ success: false, error: "invalid_input" }, { status: 400 });
  }
  if (typeof body.gameId !== "string" || !body.gameId) {
    return NextResponse.json({ success: false, error: "invalid_input" }, { status: 400 });
  }

  const title = conversationTitle(typeof body.firstMessage === "string" ? body.firstMessage : "");
  const conversation = await createConversation(getSupabaseServerClient(), { gameId: body.gameId, title, createdBy: session.email });
  if (!conversation) {
    return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
  }
  return NextResponse.json({ success: true, conversationId: conversation.id });
}
```

```ts
// app/api/assistant/conversations/[id]/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { deleteConversation } from "@/lib/assistant-store";

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }
  const ok = await deleteConversation(getSupabaseServerClient(), params.id);
  if (!ok) {
    return NextResponse.json({ success: false, error: "delete_failed" }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/api/assistant-conversations.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add app/api/assistant/conversations tests/api/assistant-conversations.test.ts
git commit -m "feat: create and delete assistant conversations"
```

---

### Task 8: 메시지 전송 라우트 (NDJSON 스트림)

**Files:**
- Create: `app/api/assistant/conversations/[id]/messages/route.ts`
- Test: `tests/api/assistant-messages.test.ts`

**Interfaces:**
- Consumes: `getConversation`, `insertMessage`, `listMessages`, `touchConversation`, `toHistory` (store); `readSpreadsheet`, `serializeSheets`, `SheetError` (sheets); `buildAssistantPrompt`, `formatToday`, `streamAssistant` (assistant); `listGames` (categories)
- Produces: 요청 `{ content }`. 스트림 이벤트(한 줄에 하나):
  ```ts
  type StreamEvent =
    | { type: "text"; text: string }
    | { type: "proposal"; messageId: string; proposal: Proposal }
    | { type: "error"; reason: AssistantErrorReason | "save_failed" };
  ```
  스트림 전 거절: 401 `unauthorized`, 400 `invalid_input`, 404 `not_found`, 400 `not_configured`(시트 ID 없음).

- [ ] **Step 1: 실패하는 테스트**

```ts
// tests/api/assistant-messages.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/assistant/conversations/[id]/messages/route";
import { readNdjson } from "@/lib/ndjson";
import * as supabaseModule from "@/lib/supabase";
import * as sessionModule from "@/lib/require-admin-session";
import * as storeModule from "@/lib/assistant-store";
import * as sheetsModule from "@/lib/sheets";
import * as assistantModule from "@/lib/assistant";
import * as categoriesModule from "@/lib/categories";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn(() => ({})) }));
vi.mock("@/lib/require-admin-session", () => ({ requireAdminSession: vi.fn(), getAdminSession: vi.fn() }));
vi.mock("@/lib/categories", () => ({ listGames: vi.fn() }));
vi.mock("@/lib/assistant-store", () => ({
  getConversation: vi.fn(),
  insertMessage: vi.fn(),
  listMessages: vi.fn(),
  touchConversation: vi.fn(),
  toHistory: vi.fn((messages: unknown[]) => messages),
}));
vi.mock("@/lib/sheets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sheets")>();
  return { ...actual, readSpreadsheet: vi.fn() };
});
vi.mock("@/lib/assistant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/assistant")>();
  return { ...actual, streamAssistant: vi.fn() };
});

const game = { id: "g1", name: "여신 키우기", status: "active", logoPath: null, ownerName: null, createdAt: "", sheetId: "sheet-1" };
const conversation = { id: "c1", gameId: "g1", title: "t", createdBy: "a@b", createdAt: "", updatedAt: "" };
const tabs = [{ title: "VIP", header: ["이메일", "VIP 단계"], rows: [["이메일", "VIP 단계"], ["a@x.com", "VIP3"]] }];
const proposal = { kind: "update" as const, sheet: "VIP", row: 2, updates: [{ column: "VIP 단계", before: "VIP3", after: "VIP4" }] };

function request(body: unknown) {
  return new Request("http://localhost/api/assistant/conversations/c1/messages", { method: "POST", body: JSON.stringify(body) });
}

async function events(response: Response) {
  const out: unknown[] = [];
  for await (const event of readNdjson(response.body!)) out.push(event);
  return out;
}

function stream(...items: assistantModule.AssistantEvent[]) {
  return (async function* () {
    for (const item of items) yield item;
  })();
}

describe("POST /api/assistant/conversations/[id]/messages", () => {
  beforeEach(() => {
    vi.mocked(sessionModule.requireAdminSession).mockReset().mockResolvedValue(true);
    vi.mocked(categoriesModule.listGames).mockReset().mockResolvedValue([game] as never);
    vi.mocked(storeModule.getConversation).mockReset().mockResolvedValue(conversation);
    vi.mocked(storeModule.listMessages).mockReset().mockResolvedValue([]);
    vi.mocked(storeModule.touchConversation).mockReset().mockResolvedValue(undefined);
    let counter = 0;
    vi.mocked(storeModule.insertMessage).mockReset().mockImplementation(async (_s, input) => ({
      id: `m${++counter}`,
      conversationId: "c1",
      role: input.role,
      content: input.content ?? "",
      proposal: input.proposal ?? null,
      status: input.status ?? null,
      failureReason: null,
      appliedBy: null,
      appliedAt: null,
      createdAt: "",
    }));
    vi.mocked(sheetsModule.readSpreadsheet).mockReset().mockResolvedValue(tabs);
    vi.mocked(assistantModule.streamAssistant).mockReset();
  });

  it("returns 401 without a session", async () => {
    vi.mocked(sessionModule.requireAdminSession).mockResolvedValue(false);
    expect((await POST(request({ content: "x" }), { params: { id: "c1" } })).status).toBe(401);
  });

  it("rejects empty content", async () => {
    expect((await POST(request({ content: "   " }), { params: { id: "c1" } })).status).toBe(400);
    expect(storeModule.insertMessage).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown conversation or game", async () => {
    vi.mocked(storeModule.getConversation).mockResolvedValue(null);
    expect((await POST(request({ content: "x" }), { params: { id: "c1" } })).status).toBe(404);
  });

  it("returns 400 not_configured when the game has no sheet", async () => {
    vi.mocked(categoriesModule.listGames).mockResolvedValue([{ ...game, sheetId: null }] as never);
    const response = await POST(request({ content: "x" }), { params: { id: "c1" } });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: "not_configured" });
  });

  it("stores the user message, streams text, and stores the assistant reply", async () => {
    vi.mocked(assistantModule.streamAssistant).mockReturnValue(stream({ type: "text", text: "VIP3" }, { type: "text", text: "입니다" }));

    const response = await POST(request({ content: "52009 VIP?" }), { params: { id: "c1" } });

    expect(response.headers.get("Content-Type")).toContain("application/x-ndjson");
    expect(await events(response)).toEqual([
      { type: "text", text: "VIP3" },
      { type: "text", text: "입니다" },
    ]);
    expect(storeModule.insertMessage).toHaveBeenNthCalledWith(1, expect.anything(), { conversationId: "c1", role: "user", content: "52009 VIP?" });
    expect(storeModule.insertMessage).toHaveBeenNthCalledWith(2, expect.anything(), { conversationId: "c1", role: "assistant", content: "VIP3입니다" });
    expect(storeModule.touchConversation).toHaveBeenCalledWith(expect.anything(), "c1");

    const args = vi.mocked(assistantModule.streamAssistant).mock.calls[0][0];
    expect(args.system).toContain("여신 키우기");
    expect(args.system).toContain("## VIP");
    expect(args.tabs).toEqual(tabs);
  });

  it("stores proposals as pending and streams their message id", async () => {
    vi.mocked(assistantModule.streamAssistant).mockReturnValue(stream({ type: "proposal", proposal }));

    const response = await POST(request({ content: "VIP4로 올려줘" }), { params: { id: "c1" } });

    expect(await events(response)).toEqual([{ type: "proposal", messageId: "m2", proposal }]);
    expect(storeModule.insertMessage).toHaveBeenNthCalledWith(2, expect.anything(), { conversationId: "c1", role: "proposal", proposal, status: "pending" });
    // 본문이 비었으니 assistant 행은 만들지 않는다.
    expect(storeModule.insertMessage).toHaveBeenCalledTimes(2);
  });

  it("streams a sheet read failure as one error event and keeps the user message", async () => {
    vi.mocked(sheetsModule.readSpreadsheet).mockRejectedValue(new sheetsModule.SheetError("sheet_forbidden"));

    const response = await POST(request({ content: "x" }), { params: { id: "c1" } });

    expect(await events(response)).toEqual([{ type: "error", reason: "sheet_forbidden" }]);
    expect(storeModule.insertMessage).toHaveBeenCalledTimes(1);
    expect(assistantModule.streamAssistant).not.toHaveBeenCalled();
  });

  it("does not store the assistant text when the stream ends in error", async () => {
    vi.mocked(assistantModule.streamAssistant).mockReturnValue(stream({ type: "text", text: "일부" }, { type: "error", reason: "model_failed" }));

    const response = await POST(request({ content: "x" }), { params: { id: "c1" } });

    expect(await events(response)).toEqual([
      { type: "text", text: "일부" },
      { type: "error", reason: "model_failed" },
    ]);
    expect(storeModule.insertMessage).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/api/assistant-messages.test.ts`
Expected: FAIL — 라우트 모듈 없음.

- [ ] **Step 3: 구현**

```ts
// app/api/assistant/conversations/[id]/messages/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { listGames } from "@/lib/categories";
import { getConversation, insertMessage, listMessages, touchConversation, toHistory } from "@/lib/assistant-store";
import { readSpreadsheet, serializeSheets, SheetError, type Proposal } from "@/lib/sheets";
import { buildAssistantPrompt, formatToday, streamAssistant, type AssistantErrorReason } from "@/lib/assistant";

type StreamEvent =
  | { type: "text"; text: string }
  | { type: "proposal"; messageId: string; proposal: Proposal }
  | { type: "error"; reason: AssistantErrorReason | "save_failed" };

/**
 * 메시지 하나를 보내고 답을 스트리밍한다. 시트 읽기 실패도 스트림의 error 한 줄로
 * 내리는 이유는 suggest 라우트와 같다 — 사용자 메시지는 이미 저장됐고, 화면이
 * 사유별 안내를 띄워야 한다.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { content?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ success: false, error: "invalid_input" }, { status: 400 });
  }
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) {
    return NextResponse.json({ success: false, error: "invalid_input" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const conversation = await getConversation(supabase, params.id);
  if (!conversation) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }
  const game = (await listGames(supabase)).find((entry) => entry.id === conversation.gameId);
  if (!game) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }
  if (!game.sheetId) {
    return NextResponse.json({ success: false, error: "not_configured" }, { status: 400 });
  }
  const sheetId = game.sheetId;

  const userMessage = await insertMessage(supabase, { conversationId: conversation.id, role: "user", content });
  if (!userMessage) {
    return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
  }
  await touchConversation(supabase, conversation.id);

  async function* run(): AsyncGenerator<StreamEvent> {
    let tabs;
    try {
      tabs = await readSpreadsheet(sheetId);
    } catch (error) {
      yield { type: "error", reason: error instanceof SheetError ? error.reason : "sheet_read_failed" };
      return;
    }

    const messages = await listMessages(supabase, conversation!.id);
    const system = buildAssistantPrompt({ gameName: game!.name, today: formatToday(), sheetText: serializeSheets(tabs) });

    let text = "";
    let failed = false;
    for await (const event of streamAssistant({ system, history: toHistory(messages), tabs })) {
      if (event.type === "text") {
        text += event.text;
        yield event;
      } else if (event.type === "proposal") {
        const saved = await insertMessage(supabase, {
          conversationId: conversation!.id,
          role: "proposal",
          proposal: event.proposal,
          status: "pending",
        });
        if (!saved) {
          yield { type: "error", reason: "save_failed" };
          failed = true;
          break;
        }
        yield { type: "proposal", messageId: saved.id, proposal: event.proposal };
      } else {
        yield event;
        failed = true;
      }
    }

    // 실패로 끝났으면 본문을 남기지 않는다 — 관리자가 같은 질문을 다시 보낸다.
    if (!failed && text.trim()) {
      await insertMessage(supabase, { conversationId: conversation!.id, role: "assistant", content: text });
    }
  }

  return new Response(toNdjsonStream(run()), {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

function toNdjsonStream(events: AsyncGenerator<StreamEvent>): ReadableStream<Uint8Array> {
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

Run: `npx vitest run tests/api/assistant-messages.test.ts && npx tsc --noEmit`
Expected: PASS. (`conversation!`/`game!` non-null 단언이 lint에 걸리면 `run` 밖에서 `const conversationId = conversation.id; const gameName = game.name;`으로 뽑아 쓴다.)

- [ ] **Step 5: 커밋**

```bash
git add app/api/assistant/conversations/[id]/messages/route.ts tests/api/assistant-messages.test.ts
git commit -m "feat: assistant message route streams answers and sheet proposals"
```

---

### Task 9: 제안 적용·취소 라우트

**Files:**
- Create: `app/api/assistant/messages/[id]/apply/route.ts`, `app/api/assistant/messages/[id]/cancel/route.ts`
- Test: `tests/api/assistant-apply.test.ts`

**Interfaces:**
- Consumes: `getMessage`, `getConversation`, `updateProposalStatus` (store); `applyProposal`, `SheetError` (sheets); `listGames`; `getAdminSession`
- Produces: `POST .../apply` → `{ success: true, status: "applied", appliedBy, appliedAt }` 또는 `{ success: false, status: "failed", failureReason }`(200). `POST .../cancel` → `{ success: true, status: "cancelled" }`. 공통 오류: 401, 404 `not_found`, 409 `not_pending`.

- [ ] **Step 1: 실패하는 테스트**

```ts
// tests/api/assistant-apply.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as apply } from "@/app/api/assistant/messages/[id]/apply/route";
import { POST as cancel } from "@/app/api/assistant/messages/[id]/cancel/route";
import * as sessionModule from "@/lib/require-admin-session";
import * as storeModule from "@/lib/assistant-store";
import * as sheetsModule from "@/lib/sheets";
import * as categoriesModule from "@/lib/categories";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn(() => ({})) }));
vi.mock("@/lib/require-admin-session", () => ({ requireAdminSession: vi.fn(), getAdminSession: vi.fn() }));
vi.mock("@/lib/categories", () => ({ listGames: vi.fn() }));
vi.mock("@/lib/assistant-store", () => ({ getMessage: vi.fn(), getConversation: vi.fn(), updateProposalStatus: vi.fn() }));
vi.mock("@/lib/sheets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sheets")>();
  return { ...actual, applyProposal: vi.fn() };
});

const proposal = { kind: "update" as const, sheet: "VIP", row: 2, updates: [{ column: "VIP 단계", before: "VIP3", after: "VIP4" }] };
const message = { id: "m1", conversationId: "c1", role: "proposal" as const, content: "", proposal, status: "pending" as const, failureReason: null, appliedBy: null, appliedAt: null, createdAt: "" };
const conversation = { id: "c1", gameId: "g1", title: "t", createdBy: "a@b", createdAt: "", updatedAt: "" };
const game = { id: "g1", name: "G", status: "active", logoPath: null, ownerName: null, createdAt: "", sheetId: "sheet-1" };

const req = () => new Request("http://localhost/x", { method: "POST" });

describe("POST /api/assistant/messages/[id]/apply", () => {
  beforeEach(() => {
    vi.mocked(sessionModule.getAdminSession).mockReset().mockResolvedValue({ id: "u1", email: "a@b" });
    vi.mocked(storeModule.getMessage).mockReset().mockResolvedValue(message);
    vi.mocked(storeModule.getConversation).mockReset().mockResolvedValue(conversation);
    vi.mocked(storeModule.updateProposalStatus).mockReset().mockResolvedValue(true);
    vi.mocked(categoriesModule.listGames).mockReset().mockResolvedValue([game] as never);
    vi.mocked(sheetsModule.applyProposal).mockReset().mockResolvedValue(undefined);
  });

  it("returns 401 without a session", async () => {
    vi.mocked(sessionModule.getAdminSession).mockResolvedValue(null);
    expect((await apply(req(), { params: { id: "m1" } })).status).toBe(401);
  });

  it("returns 404 for a missing or non-proposal message", async () => {
    vi.mocked(storeModule.getMessage).mockResolvedValue(null);
    expect((await apply(req(), { params: { id: "m1" } })).status).toBe(404);
    vi.mocked(storeModule.getMessage).mockResolvedValue({ ...message, role: "assistant", proposal: null });
    expect((await apply(req(), { params: { id: "m1" } })).status).toBe(404);
  });

  it("returns 409 when the proposal is not pending", async () => {
    vi.mocked(storeModule.getMessage).mockResolvedValue({ ...message, status: "applied" });
    const response = await apply(req(), { params: { id: "m1" } });
    expect(response.status).toBe(409);
    expect(sheetsModule.applyProposal).not.toHaveBeenCalled();
  });

  it("applies the proposal and records who did it", async () => {
    const response = await apply(req(), { params: { id: "m1" } });
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json).toMatchObject({ success: true, status: "applied", appliedBy: "a@b" });
    expect(typeof json.appliedAt).toBe("string");
    expect(sheetsModule.applyProposal).toHaveBeenCalledWith("sheet-1", proposal);
    expect(storeModule.updateProposalStatus).toHaveBeenCalledWith(expect.anything(), "m1", { status: "applied", appliedBy: "a@b", appliedAt: json.appliedAt });
  });

  it("marks the proposal failed with the sheet error reason", async () => {
    vi.mocked(sheetsModule.applyProposal).mockRejectedValue(new sheetsModule.SheetError("conflict"));
    const response = await apply(req(), { params: { id: "m1" } });
    expect(await response.json()).toEqual({ success: false, status: "failed", failureReason: "conflict" });
    expect(storeModule.updateProposalStatus).toHaveBeenCalledWith(expect.anything(), "m1", { status: "failed", failureReason: "conflict" });
  });

  it("fails with not_configured when the game lost its sheet", async () => {
    vi.mocked(categoriesModule.listGames).mockResolvedValue([{ ...game, sheetId: null }] as never);
    const response = await apply(req(), { params: { id: "m1" } });
    expect(await response.json()).toEqual({ success: false, status: "failed", failureReason: "not_configured" });
  });
});

describe("POST /api/assistant/messages/[id]/cancel", () => {
  beforeEach(() => {
    vi.mocked(sessionModule.requireAdminSession).mockReset().mockResolvedValue(true);
    vi.mocked(storeModule.getMessage).mockReset().mockResolvedValue(message);
    vi.mocked(storeModule.updateProposalStatus).mockReset().mockResolvedValue(true);
  });

  it("cancels a pending proposal", async () => {
    const response = await cancel(req(), { params: { id: "m1" } });
    expect(await response.json()).toEqual({ success: true, status: "cancelled" });
    expect(storeModule.updateProposalStatus).toHaveBeenCalledWith(expect.anything(), "m1", { status: "cancelled" });
  });

  it("returns 409 when not pending", async () => {
    vi.mocked(storeModule.getMessage).mockResolvedValue({ ...message, status: "cancelled" });
    expect((await cancel(req(), { params: { id: "m1" } })).status).toBe(409);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/api/assistant-apply.test.ts`
Expected: FAIL — 라우트 모듈 없음.

- [ ] **Step 3: 구현**

```ts
// app/api/assistant/messages/[id]/apply/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { getAdminSession } from "@/lib/require-admin-session";
import { listGames } from "@/lib/categories";
import { getConversation, getMessage, updateProposalStatus } from "@/lib/assistant-store";
import { applyProposal, SheetError, type SheetErrorReason } from "@/lib/sheets";

/** 관리자가 [적용]을 누르면 시트에 쓴다. 실패는 200으로 사유를 돌려주고 카드에 남긴다. */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  const message = await getMessage(supabase, params.id);
  if (!message || message.role !== "proposal" || !message.proposal) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }
  if (message.status !== "pending") {
    return NextResponse.json({ success: false, error: "not_pending" }, { status: 409 });
  }

  const conversation = await getConversation(supabase, message.conversationId);
  const game = conversation ? (await listGames(supabase)).find((entry) => entry.id === conversation.gameId) : undefined;

  const fail = async (reason: SheetErrorReason) => {
    await updateProposalStatus(supabase, message.id, { status: "failed", failureReason: reason });
    return NextResponse.json({ success: false, status: "failed", failureReason: reason });
  };

  if (!game?.sheetId) {
    return fail("not_configured");
  }

  try {
    await applyProposal(game.sheetId, message.proposal);
  } catch (error) {
    return fail(error instanceof SheetError ? error.reason : "sheet_write_failed");
  }

  const appliedAt = new Date().toISOString();
  await updateProposalStatus(supabase, message.id, { status: "applied", appliedBy: session.email, appliedAt });
  return NextResponse.json({ success: true, status: "applied", appliedBy: session.email, appliedAt });
}
```

```ts
// app/api/assistant/messages/[id]/cancel/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { getMessage, updateProposalStatus } from "@/lib/assistant-store";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  const message = await getMessage(supabase, params.id);
  if (!message || message.role !== "proposal") {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }
  if (message.status !== "pending") {
    return NextResponse.json({ success: false, error: "not_pending" }, { status: 409 });
  }

  const ok = await updateProposalStatus(supabase, message.id, { status: "cancelled" });
  if (!ok) {
    return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
  }
  return NextResponse.json({ success: true, status: "cancelled" });
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/api/assistant-apply.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add app/api/assistant/messages tests/api/assistant-apply.test.ts
git commit -m "feat: apply and cancel assistant sheet proposals"
```

---

### Task 10: `ProposalCard` 컴포넌트

**Files:**
- Create: `components/assistant/ProposalCard.tsx`, `components/assistant/messages.ts`(클라이언트용 메시지 타입·문구)
- Test: `tests/components/ProposalCard.test.tsx`

**Interfaces:**
- Consumes: `MessageRow` from `lib/assistant-store.ts`(타입만), `describeProposal` from `lib/assistant.ts`
- Produces:
  ```ts
  // components/assistant/messages.ts
  export type ChatMessage = Pick<MessageRow, "id" | "role" | "content" | "proposal" | "status" | "failureReason" | "appliedBy" | "appliedAt">;
  export const STREAM_ERROR_MESSAGES: Record<string, string>;   // 사유 → 안내 문구 (spec "클라이언트" 절)
  export const APPLY_FAILURE_MESSAGES: Record<string, string>;
  // components/assistant/ProposalCard.tsx
  export default function ProposalCard({ message, onChange }: { message: ChatMessage; onChange: (patch: Partial<ChatMessage>) => void }): JSX.Element;
  ```

- [ ] **Step 1: 실패하는 테스트**

```tsx
// tests/components/ProposalCard.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProposalCard from "@/components/assistant/ProposalCard";
import type { ChatMessage } from "@/components/assistant/messages";

const pending: ChatMessage = {
  id: "m1",
  role: "proposal",
  content: "",
  proposal: { kind: "update", sheet: "VIP", row: 7, updates: [{ column: "VIP 단계", before: "VIP3", after: "VIP4" }] },
  status: "pending",
  failureReason: null,
  appliedBy: null,
  appliedAt: null,
};

describe("ProposalCard", () => {
  beforeEach(() => {
    global.fetch = vi.fn() as never;
  });

  it("shows the sheet, row, and before/after values with apply and cancel", () => {
    render(<ProposalCard message={pending} onChange={vi.fn()} />);
    expect(screen.getByText("시트 수정 제안")).toBeInTheDocument();
    expect(screen.getByText("VIP")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("VIP 단계")).toBeInTheDocument();
    expect(screen.getByText("VIP3")).toBeInTheDocument();
    expect(screen.getByText("VIP4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "적용" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "취소" })).toBeEnabled();
  });

  it("renders append proposals as column/value rows", () => {
    render(
      <ProposalCard
        message={{ ...pending, proposal: { kind: "append", sheet: "VIP", values: { 이메일: "c@x.com", "VIP 단계": "VIP1" } } }}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText(/행 추가/)).toBeInTheDocument();
    expect(screen.getByText("c@x.com")).toBeInTheDocument();
  });

  it("applies via the API and reports the new status", async () => {
    const onChange = vi.fn();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, status: "applied", appliedBy: "a@b", appliedAt: "2026-09-04T03:00:00.000Z" }),
    } as never);

    render(<ProposalCard message={pending} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "적용" }));

    expect(global.fetch).toHaveBeenCalledWith("/api/assistant/messages/m1/apply", { method: "POST" });
    expect(onChange).toHaveBeenCalledWith({ status: "applied", appliedBy: "a@b", appliedAt: "2026-09-04T03:00:00.000Z", failureReason: null });
  });

  it("reports failure reasons", async () => {
    const onChange = vi.fn();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: false, status: "failed", failureReason: "conflict" }),
    } as never);

    render(<ProposalCard message={pending} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "적용" }));

    expect(onChange).toHaveBeenCalledWith({ status: "failed", failureReason: "conflict" });
  });

  it("cancels via the API", async () => {
    const onChange = vi.fn();
    vi.mocked(global.fetch).mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true, status: "cancelled" }) } as never);

    render(<ProposalCard message={pending} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(global.fetch).toHaveBeenCalledWith("/api/assistant/messages/m1/cancel", { method: "POST" });
    expect(onChange).toHaveBeenCalledWith({ status: "cancelled" });
  });

  it("shows applied, cancelled, and failed states without buttons", () => {
    const { rerender } = render(<ProposalCard message={{ ...pending, status: "applied", appliedBy: "a@b", appliedAt: "2026-09-04T03:00:00.000Z" }} onChange={vi.fn()} />);
    expect(screen.getByText(/적용됨 · a@b/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    rerender(<ProposalCard message={{ ...pending, status: "cancelled" }} onChange={vi.fn()} />);
    expect(screen.getByText("취소됨")).toBeInTheDocument();

    rerender(<ProposalCard message={{ ...pending, status: "failed", failureReason: "conflict" }} onChange={vi.fn()} />);
    expect(screen.getByText(/실패/)).toBeInTheDocument();
    expect(screen.getByText(/시트가 그 사이 바뀌었습니다/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/ProposalCard.test.tsx`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

```ts
// components/assistant/messages.ts
import type { MessageRow } from "@/lib/assistant-store";

/** 화면이 들고 있는 메시지. 서버 행에서 대화 id·시각을 뺀 것. */
export type ChatMessage = Pick<MessageRow, "id" | "role" | "content" | "proposal" | "status" | "failureReason" | "appliedBy" | "appliedAt">;

/** 스트림 error 사유 → 안내. 무엇을 고쳐야 하는지 알려줘야 한다. */
export const STREAM_ERROR_MESSAGES: Record<string, string> = {
  not_configured: "OpenAI API 키 또는 서비스 계정이 설정되지 않았습니다.",
  sheet_forbidden: "시트를 읽을 권한이 없습니다. 시트 설정에 표시된 서비스 계정에 편집자로 공유했는지 확인하세요.",
  sheet_not_found: "시트를 찾을 수 없습니다. 시트 설정의 URL을 확인하세요.",
  sheet_too_large: "시트가 너무 큽니다(300,000자 초과).",
  sheet_read_failed: "시트를 읽지 못했습니다. 잠시 후 다시 시도하세요.",
  model_failed: "응답을 받지 못했습니다. 다시 시도하세요.",
  invalid_proposal: "수정 제안을 만들지 못했습니다. 탭·열 이름을 정확히 알려주고 다시 시도하세요.",
  save_failed: "메시지를 저장하지 못했습니다.",
};

export const APPLY_FAILURE_MESSAGES: Record<string, string> = {
  conflict: "시트가 그 사이 바뀌었습니다. 다시 물어봐 주세요.",
  sheet_write_failed: "시트에 쓰지 못했습니다.",
  invalid_proposal: "제안이 시트 구조와 맞지 않습니다.",
  not_configured: "시트 연결 또는 서비스 계정 설정이 없습니다.",
  sheet_forbidden: "시트를 쓸 권한이 없습니다. 서비스 계정을 편집자로 공유했는지 확인하세요.",
};

export const GENERIC_ERROR = "요청에 실패했습니다.";
```

```tsx
// components/assistant/ProposalCard.tsx
"use client";

import { useState } from "react";
import { APPLY_FAILURE_MESSAGES, GENERIC_ERROR, type ChatMessage } from "@/components/assistant/messages";
import { formatReceivedAt } from "@/lib/format";

type ApplyResponse =
  | { success: true; status: "applied"; appliedBy: string; appliedAt: string }
  | { success: false; status: "failed"; failureReason: string }
  | { success: false; error: string };

/** 모델이 만든 시트 수정 제안. 관리자가 [적용]을 눌러야만 시트에 쓴다. */
export default function ProposalCard({ message, onChange }: { message: ChatMessage; onChange: (patch: Partial<ChatMessage>) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const proposal = message.proposal;
  if (!proposal) return null;

  async function call(action: "apply" | "cancel") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/assistant/messages/${message.id}/${action}`, { method: "POST" });
      const json = (await response.json()) as ApplyResponse | { success: true; status: "cancelled" };
      if ("status" in json && json.status === "applied") {
        onChange({ status: "applied", appliedBy: json.appliedBy, appliedAt: json.appliedAt, failureReason: null });
      } else if ("status" in json && json.status === "failed") {
        onChange({ status: "failed", failureReason: json.failureReason });
      } else if ("status" in json && json.status === "cancelled") {
        onChange({ status: "cancelled" });
      } else {
        setError(GENERIC_ERROR);
      }
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-line rounded-xl bg-panel overflow-hidden text-sm" aria-label="시트 수정 제안">
      <div className="px-4 py-2.5 border-b border-line flex items-center gap-2">
        <span className="font-semibold">시트 수정 제안</span>
        <span className="text-muted">·</span>
        <span className="text-muted">{proposal.sheet}</span>
        {proposal.kind === "update" ? (
          <span className="text-muted">
            탭 <span className="text-ink">{proposal.row}</span>행
          </span>
        ) : (
          <span className="text-muted">탭 · 행 추가</span>
        )}
      </div>

      <table className="w-full">
        <thead className="text-xs text-muted">
          <tr>
            <th className="text-left font-medium px-4 py-1.5">열</th>
            {proposal.kind === "update" && <th className="text-left font-medium px-4 py-1.5">이전값</th>}
            <th className="text-left font-medium px-4 py-1.5">{proposal.kind === "update" ? "새값" : "값"}</th>
          </tr>
        </thead>
        <tbody>
          {proposal.kind === "update"
            ? proposal.updates.map((update) => (
                <tr key={update.column} className="border-t border-line">
                  <td className="px-4 py-1.5 font-medium">{update.column}</td>
                  <td className="px-4 py-1.5 text-muted line-through">{update.before || "(비어 있음)"}</td>
                  <td className="px-4 py-1.5">{update.after}</td>
                </tr>
              ))
            : Object.entries(proposal.values).map(([column, value]) => (
                <tr key={column} className="border-t border-line">
                  <td className="px-4 py-1.5 font-medium">{column}</td>
                  <td className="px-4 py-1.5">{value}</td>
                </tr>
              ))}
        </tbody>
      </table>

      <div className="px-4 py-2.5 border-t border-line flex items-center gap-2 bg-ground/60">
        {message.status === "pending" && (
          <>
            <button
              type="button"
              onClick={() => call("apply")}
              disabled={busy}
              className="rounded-lg bg-accent text-white px-3 py-1.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              적용
            </button>
            <button
              type="button"
              onClick={() => call("cancel")}
              disabled={busy}
              className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-ground disabled:opacity-50"
            >
              취소
            </button>
            {error && <span className="text-red-600 text-xs">{error}</span>}
          </>
        )}
        {message.status === "applied" && (
          <span className="text-emerald-700 text-xs">
            적용됨 · {message.appliedBy}{message.appliedAt ? ` · ${formatReceivedAt(message.appliedAt)}` : ""}
          </span>
        )}
        {message.status === "cancelled" && <span className="text-muted text-xs">취소됨</span>}
        {message.status === "failed" && (
          <span className="text-red-600 text-xs">
            실패 · {APPLY_FAILURE_MESSAGES[message.failureReason ?? ""] ?? GENERIC_ERROR}
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/components/ProposalCard.test.tsx && npx tsc --noEmit`
Expected: PASS. ("7"이 여러 곳에 걸리면 테스트의 `getByText("7")`을 `getByText((_, el) => el?.textContent === "7")`로 좁힌다.)

- [ ] **Step 5: 커밋**

```bash
git add components/assistant/messages.ts components/assistant/ProposalCard.tsx tests/components/ProposalCard.test.tsx
git commit -m "feat: proposal card applies or cancels sheet changes"
```

---

### Task 11: `ChatPane` — 메시지 스트림과 전송

**Files:**
- Create: `components/assistant/ChatPane.tsx`
- Test: `tests/components/ChatPane.test.tsx`

**Interfaces:**
- Consumes: `ProposalCard`, `ChatMessage`, `STREAM_ERROR_MESSAGES`, `readNdjson`
- Produces:
  ```ts
  export default function ChatPane({ gameId, conversationId, initialMessages }: { gameId: string; conversationId: string | null; initialMessages: ChatMessage[] }): JSX.Element;
  ```
  대화가 없으면 첫 전송 때 `POST /api/assistant/conversations`로 만들고 `router.replace(`/games/${gameId}/assistant?c=${id}`)`, 이어서 메시지 전송.

- [ ] **Step 1: 실패하는 테스트**

```tsx
// tests/components/ChatPane.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatPane from "@/components/assistant/ChatPane";

const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh, push: vi.fn() }) }));

function ndjson(lines: unknown[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(JSON.stringify(line) + "\n"));
      controller.close();
    },
  });
  return { ok: true, body, json: () => Promise.resolve({}) };
}

describe("ChatPane", () => {
  beforeEach(() => {
    replace.mockReset();
    refresh.mockReset();
    global.fetch = vi.fn() as never;
  });

  it("renders existing messages", () => {
    render(
      <ChatPane
        gameId="g1"
        conversationId="c1"
        initialMessages={[
          { id: "m1", role: "user", content: "VIP?", proposal: null, status: null, failureReason: null, appliedBy: null, appliedAt: null },
          { id: "m2", role: "assistant", content: "VIP3입니다", proposal: null, status: null, failureReason: null, appliedBy: null, appliedAt: null },
        ]}
      />
    );
    expect(screen.getByText("VIP?")).toBeInTheDocument();
    expect(screen.getByText("VIP3입니다")).toBeInTheDocument();
  });

  it("sends a message and streams the reply into the list", async () => {
    vi.mocked(global.fetch).mockResolvedValue(ndjson([{ type: "text", text: "VIP3" }, { type: "text", text: "입니다" }]) as never);

    render(<ChatPane gameId="g1" conversationId="c1" initialMessages={[]} />);
    await userEvent.type(screen.getByRole("textbox", { name: "메시지" }), "52009 VIP?");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    expect(global.fetch).toHaveBeenCalledWith("/api/assistant/conversations/c1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "52009 VIP?" }),
    });
    expect(screen.getByText("52009 VIP?")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("VIP3입니다")).toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "메시지" })).toHaveValue("");
    expect(refresh).toHaveBeenCalled();
  });

  it("creates a conversation first when there is none", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true, conversationId: "c9" }) } as never)
      .mockResolvedValueOnce(ndjson([{ type: "text", text: "네" }]) as never);

    render(<ChatPane gameId="g1" conversationId={null} initialMessages={[]} />);
    await userEvent.type(screen.getByRole("textbox", { name: "메시지" }), "안녕");
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/games/g1/assistant?c=c9"));
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe("/api/assistant/conversations");
    expect(JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]!.body as string)).toEqual({ gameId: "g1", firstMessage: "안녕" });
    expect(vi.mocked(global.fetch).mock.calls[1][0]).toBe("/api/assistant/conversations/c9/messages");
  });

  it("renders proposals as cards", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      ndjson([{ type: "proposal", messageId: "p1", proposal: { kind: "update", sheet: "VIP", row: 2, updates: [{ column: "VIP 단계", before: "VIP3", after: "VIP4" }] } }]) as never
    );

    render(<ChatPane gameId="g1" conversationId="c1" initialMessages={[]} />);
    await userEvent.type(screen.getByRole("textbox", { name: "메시지" }), "올려줘");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => expect(screen.getByText("시트 수정 제안")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "적용" })).toBeInTheDocument();
  });

  it("shows the reason when the stream ends in error", async () => {
    vi.mocked(global.fetch).mockResolvedValue(ndjson([{ type: "error", reason: "sheet_forbidden" }]) as never);

    render(<ChatPane gameId="g1" conversationId="c1" initialMessages={[]} />);
    await userEvent.type(screen.getByRole("textbox", { name: "메시지" }), "x");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => expect(screen.getByText(/시트를 읽을 권한이 없습니다/)).toBeInTheDocument());
  });

  it("shows a JSON rejection before the stream", async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: false, body: null, json: () => Promise.resolve({ success: false, error: "not_configured" }) } as never);

    render(<ChatPane gameId="g1" conversationId="c1" initialMessages={[]} />);
    await userEvent.type(screen.getByRole("textbox", { name: "메시지" }), "x");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => expect(screen.getByText(/설정되지 않았습니다/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/ChatPane.test.tsx`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

```tsx
// components/assistant/ChatPane.tsx
"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { readNdjson } from "@/lib/ndjson";
import type { Proposal } from "@/lib/sheets";
import ProposalCard from "@/components/assistant/ProposalCard";
import { GENERIC_ERROR, STREAM_ERROR_MESSAGES, type ChatMessage } from "@/components/assistant/messages";

type StreamEvent =
  | { type: "text"; text: string }
  | { type: "proposal"; messageId: string; proposal: Proposal }
  | { type: "error"; reason: string };

function isStreamEvent(value: unknown): value is StreamEvent {
  return typeof value === "object" && value !== null && "type" in value;
}

function textMessage(id: string, role: "user" | "assistant", content: string): ChatMessage {
  return { id, role, content, proposal: null, status: null, failureReason: null, appliedBy: null, appliedAt: null };
}

/**
 * 대화 영역. 메시지 목록을 state로 들고, 전송하면 NDJSON 스트림을 읽어 어시스턴트
 * 본문을 조각마다 갱신한다. 대화가 없으면 첫 전송 때 만든다.
 */
export default function ChatPane({
  gameId,
  conversationId,
  initialMessages,
}: {
  gameId: string;
  conversationId: string | null;
  initialMessages: ChatMessage[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  function patchMessage(id: string, patch: Partial<ChatMessage>) {
    setMessages((current) => current.map((message) => (message.id === id ? { ...message, ...patch } : message)));
  }

  async function ensureConversation(firstMessage: string): Promise<string | null> {
    if (conversationId) return conversationId;
    const response = await fetch("/api/assistant/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameId, firstMessage }),
    });
    const json = (await response.json()) as { success: boolean; conversationId?: string };
    if (!json.success || !json.conversationId) return null;
    router.replace(`/games/${gameId}/assistant?c=${json.conversationId}`);
    return json.conversationId;
  }

  async function send() {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    setDraft("");

    const localUserId = `local-user-${Date.now()}`;
    const localAssistantId = `local-assistant-${Date.now()}`;
    setMessages((current) => [...current, textMessage(localUserId, "user", content)]);

    let failure: string | null = null;
    let text = "";

    try {
      const id = await ensureConversation(content);
      if (!id) {
        failure = "save_failed";
      } else {
        const response = await fetch(`/api/assistant/conversations/${id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });

        if (!response.ok || !response.body) {
          const json = (await response.json()) as { error?: string };
          failure = json.error ?? "failed";
        } else {
          for await (const event of readNdjson(response.body)) {
            if (!isStreamEvent(event)) continue;
            if (event.type === "text") {
              text += event.text;
              const snapshot = text;
              setMessages((current) => {
                const exists = current.some((message) => message.id === localAssistantId);
                return exists
                  ? current.map((message) => (message.id === localAssistantId ? { ...message, content: snapshot } : message))
                  : [...current, textMessage(localAssistantId, "assistant", snapshot)];
              });
            } else if (event.type === "proposal") {
              setMessages((current) => [
                ...current,
                { id: event.messageId, role: "proposal", content: "", proposal: event.proposal, status: "pending", failureReason: null, appliedBy: null, appliedAt: null },
              ]);
            } else {
              failure = event.reason;
            }
          }
        }
      }
    } catch {
      failure = "failed";
    }

    setSending(false);
    if (failure) {
      setError(STREAM_ERROR_MESSAGES[failure] ?? GENERIC_ERROR);
    }
    // 사이드바의 대화 제목·순서는 서버가 안다.
    router.refresh();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void send();
    }
  }

  return (
    <section className="flex-1 min-w-0 h-full flex flex-col" aria-label="대화">
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-4">
          {messages.length === 0 && (
            <p className="text-center text-muted text-sm py-16">시트에 대해 물어보거나 수정을 요청하세요. 예: “52009 VIP 몇이야”, “52009 VIP4로 올려줘”</p>
          )}
          {messages.map((message) => {
            if (message.role === "user") {
              return (
                <div key={message.id} className="self-end max-w-[80%] rounded-2xl rounded-br-md bg-accent text-white px-4 py-2.5 text-sm whitespace-pre-wrap">
                  {message.content}
                </div>
              );
            }
            if (message.role === "proposal") {
              return (
                <div key={message.id} className="self-start w-full max-w-[90%]">
                  <ProposalCard message={message} onChange={(patch) => patchMessage(message.id, patch)} />
                </div>
              );
            }
            return (
              <div key={message.id} className="self-start max-w-[90%] text-sm leading-relaxed whitespace-pre-wrap">
                {message.content}
                {sending && message.id.startsWith("local-assistant-") && <span className="inline-block w-2 h-4 ml-0.5 bg-ink/60 animate-pulse align-text-bottom" aria-hidden="true" />}
              </div>
            );
          })}
          {error && <p className="text-red-600 text-sm" role="alert">{error}</p>}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-line bg-panel px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-end gap-2">
          <textarea
            aria-label="메시지"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            disabled={sending}
            rows={2}
            placeholder="메시지를 입력하세요 (Cmd/Ctrl+Enter 전송)"
            className="flex-1 resize-none rounded-xl border border-line bg-panel px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending || !draft.trim()}
            className="rounded-xl bg-accent text-white px-4 py-3 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {sending ? "전송 중…" : "보내기"}
          </button>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/components/ChatPane.test.tsx && npx tsc --noEmit`
Expected: PASS. (jsdom에 `scrollIntoView`가 없으면 `bottomRef.current?.scrollIntoView?.(...)`로 옵셔널 호출한다.)

- [ ] **Step 5: 커밋**

```bash
git add components/assistant/ChatPane.tsx tests/components/ChatPane.test.tsx
git commit -m "feat: assistant chat pane streams replies and proposal cards"
```

---

### Task 12: 사이드바, 시트 설정 모달, 셸, 페이지

**Files:**
- Create: `components/assistant/ConversationSidebar.tsx`, `components/assistant/SheetSettingsDialog.tsx`, `components/assistant/AssistantShell.tsx`, `app/(assistant)/games/[gameId]/assistant/page.tsx`
- Test: `tests/components/ConversationSidebar.test.tsx`, `tests/components/SheetSettingsDialog.test.tsx`

**Interfaces:**
- Consumes: `ChatPane`, `ChatMessage`, `ConversationRow`, `listConversations`, `listMessages`, `listGames`, `serviceAccountEmail`
- Produces:
  ```ts
  ConversationSidebar({ gameId, gameName, conversations, selectedId, onOpenSettings }): JSX.Element
  SheetSettingsDialog({ gameId, currentSheetId, serviceAccountEmail, onClose }): JSX.Element
  AssistantShell({ game: { id, name, sheetId }, conversations, selectedId, messages, serviceAccountEmail }): JSX.Element
  ```

- [ ] **Step 1: 실패하는 테스트**

```tsx
// tests/components/ConversationSidebar.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConversationSidebar from "@/components/assistant/ConversationSidebar";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh, replace: vi.fn() }) }));

const conversations = [
  { id: "c1", gameId: "g1", title: "VIP 확인", createdBy: "a@b", createdAt: "", updatedAt: "" },
  { id: "c2", gameId: "g1", title: "보상 코드", createdBy: "a@b", createdAt: "", updatedAt: "" },
];

describe("ConversationSidebar", () => {
  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true }) }) as never;
  });

  it("lists conversations linking to ?c= and marks the selected one", () => {
    render(<ConversationSidebar gameId="g1" gameName="여신 키우기" conversations={conversations} selectedId="c2" onOpenSettings={vi.fn()} />);
    expect(screen.getByText("여신 키우기")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "VIP 확인" })).toHaveAttribute("href", "/games/g1/assistant?c=c1");
    expect(screen.getByRole("link", { name: "보상 코드" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: /새 대화/ })).toHaveAttribute("href", "/games/g1/assistant");
  });

  it("deletes a conversation and navigates away when it was selected", async () => {
    render(<ConversationSidebar gameId="g1" gameName="G" conversations={conversations} selectedId="c1" onOpenSettings={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "VIP 확인 삭제" }));
    expect(global.fetch).toHaveBeenCalledWith("/api/assistant/conversations/c1", { method: "DELETE" });
    expect(push).toHaveBeenCalledWith("/games/g1/assistant");
  });

  it("opens settings", async () => {
    const onOpenSettings = vi.fn();
    render(<ConversationSidebar gameId="g1" gameName="G" conversations={[]} selectedId={null} onOpenSettings={onOpenSettings} />);
    await userEvent.click(screen.getByRole("button", { name: /시트 설정/ }));
    expect(onOpenSettings).toHaveBeenCalled();
  });
});
```

```tsx
// tests/components/SheetSettingsDialog.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SheetSettingsDialog from "@/components/assistant/SheetSettingsDialog";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));

describe("SheetSettingsDialog", () => {
  beforeEach(() => {
    refresh.mockReset();
    global.fetch = vi.fn() as never;
  });

  it("shows the service account to share with", () => {
    render(<SheetSettingsDialog gameId="g1" currentSheetId={null} serviceAccountEmail="bot@proj.iam.gserviceaccount.com" onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "시트 설정" })).toBeInTheDocument();
    expect(screen.getByText("bot@proj.iam.gserviceaccount.com")).toBeInTheDocument();
  });

  it("tells the admin to set the env var when there is no service account", () => {
    render(<SheetSettingsDialog gameId="g1" currentSheetId={null} serviceAccountEmail={null} onClose={vi.fn()} />);
    expect(screen.getByText(/GOOGLE_SERVICE_ACCOUNT_JSON/)).toBeInTheDocument();
  });

  it("saves the url via PATCH and refreshes", async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true, sheetId: "1AbC", serviceAccountEmail: "bot@x" }) } as never);
    const onClose = vi.fn();
    render(<SheetSettingsDialog gameId="g1" currentSheetId={null} serviceAccountEmail="bot@x" onClose={onClose} />);

    await userEvent.type(screen.getByRole("textbox", { name: "시트 URL" }), "https://docs.google.com/spreadsheets/d/1AbC/edit");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(global.fetch).toHaveBeenCalledWith("/api/games/g1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sheetUrl: "https://docs.google.com/spreadsheets/d/1AbC/edit" }),
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an inline error for an invalid url", async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: false, json: () => Promise.resolve({ success: false, error: "invalid_input" }) } as never);
    render(<SheetSettingsDialog gameId="g1" currentSheetId={null} serviceAccountEmail="bot@x" onClose={vi.fn()} />);

    await userEvent.type(screen.getByRole("textbox", { name: "시트 URL" }), "nope");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(screen.getByText(/URL을 확인/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/ConversationSidebar.test.tsx tests/components/SheetSettingsDialog.test.tsx`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

```tsx
// components/assistant/ConversationSidebar.tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ConversationRow } from "@/lib/assistant-store";

export default function ConversationSidebar({
  gameId,
  gameName,
  conversations,
  selectedId,
  onOpenSettings,
}: {
  gameId: string;
  gameName: string;
  conversations: ConversationRow[];
  selectedId: string | null;
  onOpenSettings: () => void;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);
  const base = `/games/${gameId}/assistant`;

  async function remove(conversation: ConversationRow) {
    setDeleting(conversation.id);
    try {
      await fetch(`/api/assistant/conversations/${conversation.id}`, { method: "DELETE" });
    } finally {
      setDeleting(null);
    }
    if (conversation.id === selectedId) {
      router.push(base);
    } else {
      router.refresh();
    }
  }

  return (
    <aside className="w-[260px] shrink-0 h-full bg-panel border-r border-line flex flex-col" aria-label="대화 목록">
      <div className="px-4 pt-4 pb-3 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-bold truncate">{gameName}</h1>
          <span className="text-[11px] text-muted shrink-0">운영 어시스턴트</span>
        </div>
        <Link href={base} className="inline-flex items-center justify-center gap-1 rounded-lg border border-line px-3 py-2 text-sm hover:bg-ground">
          + 새 대화
        </Link>
      </div>

      <ul className="flex-1 overflow-y-auto px-2 flex flex-col gap-0.5">
        {conversations.length === 0 && <li className="px-2.5 py-2 text-xs text-muted">아직 대화가 없습니다.</li>}
        {conversations.map((conversation) => {
          const active = conversation.id === selectedId;
          return (
            <li key={conversation.id} className="group relative">
              <Link
                href={`${base}?c=${conversation.id}`}
                aria-current={active ? "true" : undefined}
                className={`block rounded-lg px-2.5 py-2 pr-8 text-sm truncate ${active ? "bg-ground font-medium" : "hover:bg-ground/70"}`}
              >
                {conversation.title}
              </Link>
              <button
                type="button"
                aria-label={`${conversation.title} 삭제`}
                onClick={() => void remove(conversation)}
                disabled={deleting === conversation.id}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-red-600 disabled:opacity-50"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                </svg>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-line p-2">
        <button type="button" onClick={onOpenSettings} className="w-full text-left rounded-lg px-2.5 py-2 text-sm text-muted hover:bg-ground hover:text-ink">
          ⚙ 시트 설정
        </button>
      </div>
    </aside>
  );
}
```

```tsx
// components/assistant/SheetSettingsDialog.tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function SheetSettingsDialog({
  gameId,
  currentSheetId,
  serviceAccountEmail,
  onClose,
}: {
  gameId: string;
  currentSheetId: string | null;
  serviceAccountEmail: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [url, setUrl] = useState(currentSheetId ? `https://docs.google.com/spreadsheets/d/${currentSheetId}/edit` : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/games/${gameId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetUrl: url }),
      });
      const json = (await response.json()) as { success: boolean; error?: string };
      if (!json.success) {
        setError(json.error === "invalid_input" ? "시트 URL을 확인하세요. docs.google.com/spreadsheets/d/… 형태여야 합니다." : "저장하지 못했습니다.");
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
        aria-label="시트 설정"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-lg rounded-2xl bg-panel border border-line shadow-xl p-6 flex flex-col gap-4"
      >
        <h2 className="text-base font-bold">시트 설정</h2>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">시트 URL</span>
          <input
            aria-label="시트 URL"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/…"
            className="rounded-lg border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </label>

        <div className="rounded-lg bg-ground px-3 py-2.5 text-xs leading-relaxed">
          {serviceAccountEmail ? (
            <>
              시트를 아래 서비스 계정에 <strong>편집자</strong>로 공유하세요.
              <div className="mt-1 font-mono text-[12px] select-all">{serviceAccountEmail}</div>
              <div className="mt-2 text-muted">수정까지 쓰려면 탭의 첫 줄에 열 이름을 두세요(예: 이메일 / ID / VIP 단계 / 갱신일).</div>
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
            저장
          </button>
        </div>
      </form>
    </div>
  );
}
```

```tsx
// components/assistant/AssistantShell.tsx
"use client";

import { useState } from "react";
import type { ConversationRow } from "@/lib/assistant-store";
import ConversationSidebar from "@/components/assistant/ConversationSidebar";
import ChatPane from "@/components/assistant/ChatPane";
import SheetSettingsDialog from "@/components/assistant/SheetSettingsDialog";
import type { ChatMessage } from "@/components/assistant/messages";

export default function AssistantShell({
  game,
  conversations,
  selectedId,
  messages,
  serviceAccountEmail,
}: {
  game: { id: string; name: string; sheetId: string | null };
  conversations: ConversationRow[];
  selectedId: string | null;
  messages: ChatMessage[];
  serviceAccountEmail: string | null;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="h-screen flex bg-ground">
      <ConversationSidebar gameId={game.id} gameName={game.name} conversations={conversations} selectedId={selectedId} onOpenSettings={() => setSettingsOpen(true)} />

      {game.sheetId ? (
        <ChatPane key={selectedId ?? "new"} gameId={game.id} conversationId={selectedId} initialMessages={messages} />
      ) : (
        <section className="flex-1 flex items-center justify-center" aria-label="대화">
          <div className="text-center flex flex-col items-center gap-3">
            <p className="text-sm text-muted">이 게임에 연결된 운영 시트가 없습니다.</p>
            <button type="button" onClick={() => setSettingsOpen(true)} className="rounded-lg bg-accent text-white px-4 py-2 text-sm font-medium hover:opacity-90">
              시트 연결하기
            </button>
          </div>
        </section>
      )}

      {settingsOpen && (
        <SheetSettingsDialog gameId={game.id} currentSheetId={game.sheetId} serviceAccountEmail={serviceAccountEmail} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}
```

```tsx
// app/(assistant)/games/[gameId]/assistant/page.tsx
import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { listGames } from "@/lib/categories";
import { listConversations, listMessages } from "@/lib/assistant-store";
import { serviceAccountEmail } from "@/lib/sheets";
import AssistantShell from "@/components/assistant/AssistantShell";

export const dynamic = "force-dynamic";

/**
 * 운영 시트 어시스턴트. 관리자 레일 없이 전체 화면을 쓴다(문의함에서 새 탭으로 연다).
 * ?c={conversationId}로 대화를 고른다.
 */
export default async function AssistantPage({
  params,
  searchParams,
}: {
  params: { gameId: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const supabase = getSupabaseServerClient();
  const games = await listGames(supabase);
  const game = games.find((entry) => entry.id === params.gameId);
  if (!game) {
    notFound();
  }

  const conversations = await listConversations(supabase, game.id);
  const requested = typeof searchParams.c === "string" ? searchParams.c : null;
  const selected = requested ? conversations.find((entry) => entry.id === requested) ?? null : null;
  const messages = selected ? await listMessages(supabase, selected.id) : [];

  return (
    <AssistantShell
      game={{ id: game.id, name: game.name, sheetId: game.sheetId }}
      conversations={conversations}
      selectedId={selected?.id ?? null}
      messages={messages.map(({ id, role, content, proposal, status, failureReason, appliedBy, appliedAt }) => ({ id, role, content, proposal, status, failureReason, appliedBy, appliedAt }))}
      serviceAccountEmail={serviceAccountEmail()}
    />
  );
}
```

- [ ] **Step 4: 통과 확인 + 화면 확인**

Run: `npx vitest run tests/components/ConversationSidebar.test.tsx tests/components/SheetSettingsDialog.test.tsx && npx tsc --noEmit`
Expected: PASS.

`(admin)`과 `(assistant)` 두 그룹이 같은 `/games/[gameId]/…` 경로를 나눠 갖는다. `next build`는 세그먼트가 달라(`inquiries` vs `assistant`) 충돌하지 않는다. 확인: `npx next build` 가 "You cannot have two parallel pages that resolve to the same path" 오류 없이 끝나야 한다(시간이 오래 걸리면 `npx tsc --noEmit`만 하고 Task 14에서 dev 서버로 확인).

- [ ] **Step 5: 커밋**

```bash
git add components/assistant "app/(assistant)" tests/components/ConversationSidebar.test.tsx tests/components/SheetSettingsDialog.test.tsx
git commit -m "feat: assistant page with conversation sidebar and sheet settings"
```

---

### Task 13: 문의함 보기 열의 진입 링크

**Files:**
- Modify: `components/inbox/InboxNav.tsx:75` (`<InboxSearch …/>` 바로 아래)
- Test: `tests/components/InboxNav.test.tsx` (추가)

- [ ] **Step 1: 실패하는 테스트 (`describe("InboxNav")` 안에 추가)**

```tsx
  it("links to the operations assistant in a new tab for a game", () => {
    renderNav();
    const link = screen.getByRole("link", { name: /운영 어시스턴트/ });
    expect(link).toHaveAttribute("href", "/games/g1/assistant");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener");
  });

  it("does not show the assistant link for service inquiries", () => {
    renderServiceNav();
    expect(screen.queryByRole("link", { name: /운영 어시스턴트/ })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/InboxNav.test.tsx`
Expected: 새 케이스 1개 FAIL(링크 없음).

- [ ] **Step 3: 구현 — `InboxNav.tsx`에서 `<InboxSearch scope={scope} query={query} selectedId={selectedId} />` 바로 뒤에 추가**

```tsx
      {game && (
        <Link
          href={`/games/${game.id}/assistant`}
          target="_blank"
          rel="noopener"
          className={`${ITEM} h-8 ${ITEM_IDLE} border border-line`}
        >
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true">✦</span>
            <span>운영 어시스턴트</span>
          </span>
          <span className="text-xs text-muted" aria-hidden="true">↗</span>
        </Link>
      )}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/components/InboxNav.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add components/inbox/InboxNav.tsx tests/components/InboxNav.test.tsx
git commit -m "feat: inbox nav links to the operations assistant in a new tab"
```

---

### Task 14: 문서, 전체 테스트, 실제 화면 확인

**Files:**
- Modify: `CLAUDE.md`(핵심 기능 8번 + 설정 절차), `docs/PRD.md`(기능 목록에 한 줄)

- [ ] **Step 1: `CLAUDE.md` 핵심 기능 목록 끝(7번 뒤)에 추가**

```markdown
8. **운영 시트 어시스턴트** — 문의함 보기 열의 "운영 어시스턴트 ↗"가 새 탭으로 `/games/{gameId}/assistant`를 연다(`app/(assistant)/`, 레일 없음). 게임에 연결한 구글 스프레드시트(`games.sheet_id`, 화면의 "시트 설정"에서 URL 입력)를 서비스 계정(`GOOGLE_SERVICE_ACCOUNT_JSON`, 시트를 그 계정에 편집자로 공유)으로 매번 통째로 읽어 텍스트 표로 만들고 OpenAI(`OPENAI_API_KEY`, `OPENAI_MODEL` 기본 `gpt-5-mini`)에 시스템 프롬프트로 싣는다(`lib/sheets.ts`, `lib/assistant.ts`). 임베딩 검색은 쓰지 않는다. "52009 VIP4로 올려줘" 같은 수정 요청은 모델이 `propose_update`/`propose_append` 도구로 제안만 만들고, 서버가 탭·열·행을 검증해 `assistant_messages`에 `pending`으로 저장하며, 관리자가 카드의 [적용]을 눌러야 그 행을 다시 읽어 충돌을 확인한 뒤 Sheets API로 쓴다(마이그레이션 0017). 첫 줄이 열 이름인 탭만 수정할 수 있고 줄글 탭은 읽기 전용이다. 대화는 게임별로 저장되고 ChatGPT식 사이드바에서 고른다(`?c=`). 설계는 `docs/superpowers/specs/2026-09-04-sheet-assistant-design.md`.
```

"자동 답변 설정 절차" 절 뒤에 추가:

```markdown
## 운영 시트 어시스턴트 설정 절차

1. Google Cloud 콘솔 → 프로젝트 선택 → "Google Sheets API" 사용 설정 → IAM → 서비스 계정 만들기 → 키(JSON) 발급
2. 키 파일 내용을 한 줄로 만들어 `GOOGLE_SERVICE_ACCOUNT_JSON`에, OpenAI 키를 `OPENAI_API_KEY`에 넣고 재배포
3. Supabase SQL Editor에서 `0015_assistant.sql` 실행
4. 게임 운영 시트를 만든다. 수정까지 쓰려면 탭 첫 줄에 열 이름을 둔다(예: VIP 탭 = 이메일 / ID / 서버 / 닉네임 / VIP 단계 / 갱신일)
5. 관리자 페이지 → 게임 문의함 → "운영 어시스턴트" → "시트 설정"에 URL을 넣고, 안내된 서비스 계정 이메일에 시트를 편집자로 공유
6. "52009 VIP 몇이야"로 읽기, "52009 VIP4로 올려줘" → 제안 카드 → [적용] → 시트 반영 확인
```

- [ ] **Step 2: `docs/PRD.md`의 기능 목록에 한 줄 추가** (기존 항목 형식을 따라 "운영 시트 어시스턴트: 게임별 구글 시트를 근거로 자연어 질의·확인 후 수정, `/games/{gameId}/assistant`")

- [ ] **Step 3: 전체 테스트·타입**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 전부 PASS.

- [ ] **Step 4: 실제 화면 확인**

메모리 `dev-server-shared-next-cache`대로 이 체크아웃에서 `next dev`를 새로 띄우지 말고, 이미 떠 있는 서버가 있으면 그것을 쓴다. 없으면 스크래치패드에 복사본을 만들어 3002로 띄운다. `.env.local`에 `OPENAI_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`이 없으면 화면에서 `not_configured` 안내가 뜨는 것까지만 확인한다.

확인 항목:
1. 게임 문의함 → "운영 어시스턴트 ↗" → 새 탭에 어시스턴트 페이지, 레일 없음
2. 시트 미연결 → "시트 연결하기" → 모달에 서비스 계정 이메일(또는 환경변수 안내)
3. URL 저장 → 대화 영역 → 메시지 전송 → 스트리밍 또는 사유별 오류 안내
4. (키가 있으면) 수정 요청 → 카드 → [적용] → 시트 반영, 새로고침 후 "적용됨" 유지

- [ ] **Step 5: 커밋**

```bash
git add CLAUDE.md docs/PRD.md
git commit -m "docs: record the operations sheet assistant and its setup"
```

---

## Self-Review

- **Spec coverage**: 진입 링크(13), 레이아웃·사이드바·설정 모달·메시지 종류(10–12), 데이터 모델(1), 시트 연동(2–3), 프롬프트·도구·스트리밍·이력(4–5), API 6개(6–9), 오류 문구(10), 환경변수(1), 테스트(각 태스크), 설정 절차(14). 스펙의 "제목 = 첫 40자"는 Task 5 `conversationTitle` + Task 7. 스펙의 `?c=` 선택은 Task 12 페이지.
- **Type consistency**: `Proposal`/`SheetTab`/`SheetError`(Task 2) → Task 3·4·8·9. `ProposalStatus`·`HistoryMessage`(Task 4) → Task 5. `MessageRow`(Task 5) → `ChatMessage`(Task 10) → Task 11·12. 스트림 이벤트 `{ type: "proposal", messageId, proposal }`는 Task 8 서버와 Task 11 클라이언트가 같다. apply 응답 `{ success, status, appliedBy, appliedAt } | { success: false, status: "failed", failureReason }`는 Task 9와 Task 10이 같다.
- **Placeholder scan**: 없음. Task 14 Step 2의 PRD 한 줄은 기존 문서 형식을 따르라는 지시이고 내용은 적혀 있다.
