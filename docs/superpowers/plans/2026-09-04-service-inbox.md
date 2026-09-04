# 서비스 문의 인박스 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 게임 레일 맨 위의 "서비스 문의" 타일을 누르면 `game_id is null`인 문의(제휴·기타)가 기존 인박스 4단 화면으로 열리고, Slack 알림·답변 추천도 게임 없는 문의에서 동작한다.

**Architecture:** 인박스가 다루는 범위를 `InboxScope`(게임 하나 | 서비스)로 일반화한다. URL 헬퍼·쿼리·건수 RPC·컴포넌트가 `gameId: string` 대신 스코프를 받고, 서비스 스코프는 `/service/inquiries`와 `game_id is null`로 풀린다. 페이지 로딩은 `lib/inbox-page.ts` 하나로 모아 게임 페이지와 서비스 페이지가 같이 쓴다.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase(service-role 클라이언트), Vitest + React Testing Library, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-04-service-inbox-design.md`

## Global Constraints

- 관리자 UI 문구는 한국어 전용.
- 카테고리는 하드코딩하지 않는다. 서비스 유형 라벨은 `service_groups`/`service_types`에서 읽는다.
- 부가 정보(라벨·건수) 조회가 실패해도 목록·답변은 막지 않는다.
- 마이그레이션은 재실행 가능해야 한다(`create or replace`, `if not exists`, `on conflict do nothing`).
- 서비스 문의용 답변 템플릿은 만들지 않는다(`reply_templates.game_id`는 not null 유지). 서비스 스코프에는 빈 템플릿 배열을 넘긴다.
- 게임 스코프의 URL(`/games/{gameId}/inquiries[/{id}]`)과 동작은 바뀌지 않는다. 기존 테스트는 인자 모양만 바꾸고 기대값은 유지한다.
- 테스트 실행: `npm test -- <파일경로>` (vitest run). 타입 검사: `npx tsc --noEmit`. 커밋 메시지 끝에 아래 두 줄을 붙인다.

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5jqLuCMqTMFeYsSa8txRe
```

---

## File Structure

| 파일 | 역할 |
|---|---|
| `lib/inbox-scope.ts` (신규) | `InboxScope` 타입과 순수 헬퍼. 다른 lib·컴포넌트가 전부 여기에 의존한다. |
| `lib/inquiry-filters.ts` | URL 헬퍼 4개가 첫 인자로 스코프를 받는다. |
| `lib/inquiries.ts` | 목록·id·건수 조회가 스코프로 `game_id` 조건을 만든다. `InquiryRow.gameId`가 nullable. |
| `lib/categories.ts` | `listServiceCategoryLabels`, `listCategoryLabelsForScope` 추가. |
| `lib/replies.ts` | 과거 답변 조회가 스코프를 받는다. |
| `lib/inbox-page.ts` (신규) | 두 인박스 페이지가 공유하는 서버 데이터 로더. |
| `supabase/migrations/0009_service_inquiry_facets.sql` (신규) | 건수 RPC가 null 인자를 서비스 문의로 센다. |
| `supabase/migrations/0010_service_categories.sql` (신규) | 접수 폼 저장소 0003의 사본(기록용). |
| `app/(admin)/service/inquiries/[[...inquiryId]]/page.tsx` (신규) | 서비스 스코프 인박스 페이지. |
| `app/(admin)/games/[gameId]/inquiries/[[...inquiryId]]/page.tsx` | 로더 호출만 남긴다. |
| `app/(admin)/inquiries/[id]/page.tsx` | `game_id` null이면 서비스 URL로 리다이렉트. |
| `components/layout/GameRail.tsx` | 서비스 문의 타일. |
| `components/inbox/InboxNav.tsx` | 스코프·제목을 받고 게임 전용 요소는 게임일 때만. |
| `components/inbox/InboxShell.tsx`, `InboxList.tsx`, `InboxSearch.tsx`, `InboxPrevNext.tsx`, `InboxConversation.tsx` | `gameId` prop → `scope`. |
| `components/inbox/InboxDetailPanel.tsx` | `history`가 null이면 계정 이력 탭 없음. |
| `app/api/notify/inquiry/route.ts` | `game_id` null 허용. |
| `app/api/inquiries/[id]/suggest/route.ts`, `reply/route.ts` | 스코프 기반 라벨·템플릿·과거 답변. |

---

### Task 1: `lib/inbox-scope.ts`

**Files:**
- Create: `lib/inbox-scope.ts`
- Test: `tests/lib/inbox-scope.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type InboxScope = { kind: "game"; gameId: string } | { kind: "service" };
  export const SERVICE_SCOPE: InboxScope;
  export const SERVICE_RAIL_KEY = "service";          // countNewInquiriesByGame의 서비스 건수 키
  export const SERVICE_SCOPE_TITLE = "서비스 문의";
  export function gameScope(gameId: string): InboxScope;
  export function scopeForGameId(gameId: string | null): InboxScope; // 문의 행의 game_id로 스코프 결정
  export function scopeBasePath(scope: InboxScope): string;          // "/games/{id}" | "/service"
  export function scopeGameId(scope: InboxScope): string | null;
  export function inquiryBelongsToScope(scope: InboxScope, gameId: string | null): boolean;
  ```

- [ ] **Step 1: Write the failing test**

`tests/lib/inbox-scope.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  SERVICE_RAIL_KEY,
  SERVICE_SCOPE,
  SERVICE_SCOPE_TITLE,
  gameScope,
  inquiryBelongsToScope,
  scopeBasePath,
  scopeForGameId,
  scopeGameId,
} from "@/lib/inbox-scope";

describe("inbox scope", () => {
  it("builds the base path for a game and for the service inbox", () => {
    expect(scopeBasePath(gameScope("g1"))).toBe("/games/g1");
    expect(scopeBasePath(SERVICE_SCOPE)).toBe("/service");
  });

  it("maps a scope to the game_id value used in queries", () => {
    expect(scopeGameId(gameScope("g1"))).toBe("g1");
    expect(scopeGameId(SERVICE_SCOPE)).toBeNull();
  });

  it("derives a scope from an inquiry row's game_id", () => {
    expect(scopeForGameId("g1")).toEqual({ kind: "game", gameId: "g1" });
    expect(scopeForGameId(null)).toEqual({ kind: "service" });
  });

  it("checks whether an inquiry belongs to a scope", () => {
    expect(inquiryBelongsToScope(gameScope("g1"), "g1")).toBe(true);
    expect(inquiryBelongsToScope(gameScope("g1"), "g2")).toBe(false);
    expect(inquiryBelongsToScope(gameScope("g1"), null)).toBe(false);
    expect(inquiryBelongsToScope(SERVICE_SCOPE, null)).toBe(true);
    expect(inquiryBelongsToScope(SERVICE_SCOPE, "g1")).toBe(false);
  });

  it("exposes the rail key and title used by the game rail", () => {
    expect(SERVICE_RAIL_KEY).toBe("service");
    expect(SERVICE_SCOPE_TITLE).toBe("서비스 문의");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/inbox-scope.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/inbox-scope"`

- [ ] **Step 3: Write the implementation**

`lib/inbox-scope.ts`:

```ts
/**
 * 인박스가 다루는 범위. 게임 하나이거나, 게임 없이 접수된 서비스 문의(제휴·기타)다.
 * 서비스 문의는 inquiries.game_id가 null이고 URL은 /service/inquiries 아래에 있다.
 */
export type InboxScope = { kind: "game"; gameId: string } | { kind: "service" };

export const SERVICE_SCOPE: InboxScope = { kind: "service" };

/** countNewInquiriesByGame이 서비스 문의 건수를 담는 키. 게임 id는 uuid라 충돌하지 않는다. */
export const SERVICE_RAIL_KEY = "service";

export const SERVICE_SCOPE_TITLE = "서비스 문의";

export function gameScope(gameId: string): InboxScope {
  return { kind: "game", gameId };
}

/** 문의 행의 game_id로 그 문의가 속한 스코프를 정한다. */
export function scopeForGameId(gameId: string | null): InboxScope {
  return gameId ? gameScope(gameId) : SERVICE_SCOPE;
}

/** URL 앞부분. 뒤에 /inquiries, /templates 등이 붙는다. */
export function scopeBasePath(scope: InboxScope): string {
  return scope.kind === "game" ? `/games/${scope.gameId}` : "/service";
}

/** DB 쿼리·RPC에 넘길 game_id 값. 서비스는 null. */
export function scopeGameId(scope: InboxScope): string | null {
  return scope.kind === "game" ? scope.gameId : null;
}

export function inquiryBelongsToScope(scope: InboxScope, gameId: string | null): boolean {
  return scopeGameId(scope) === gameId;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/lib/inbox-scope.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/inbox-scope.ts tests/lib/inbox-scope.test.ts
git commit -m "feat: add InboxScope for game vs service inquiry inboxes"
```

---

### Task 2: URL 헬퍼와 링크를 만드는 컴포넌트가 스코프를 받는다

**Files:**
- Modify: `lib/inquiry-filters.ts:96-125`
- Modify: `components/inbox/InboxSearch.tsx`, `components/inbox/InboxPrevNext.tsx`, `components/inbox/InboxList.tsx`, `components/inbox/InboxConversation.tsx`, `components/inbox/InboxNav.tsx`, `components/inbox/InboxShell.tsx`
- Modify: `app/(admin)/inquiries/[id]/page.tsx:25`
- Test: `tests/lib/inquiry-filters.test.ts`, `tests/components/InboxSearch.test.tsx`, `tests/components/InboxPrevNext.test.tsx`, `tests/components/InboxList.test.tsx`, `tests/components/InboxConversation.test.tsx`

**Interfaces:**
- Consumes: `InboxScope`, `gameScope`, `SERVICE_SCOPE`, `scopeBasePath`, `scopeForGameId` (Task 1)
- Produces:
  ```ts
  export function inquiryListHref(scope: InboxScope, query: InquiryListQuery): string;
  export function inquiryHref(scope: InboxScope, inquiryId: string, query: InquiryListQuery): string;
  export function inboxHref(scope: InboxScope, selectedId: string | null, query: InquiryListQuery): string;
  export function legacyInquiryRedirectHref(scope: InboxScope, inquiryId: string, listParam: string | null | undefined): string;
  ```
  컴포넌트 prop: `InboxSearch`, `InboxPrevNext`, `InboxList`, `InboxConversation`는 `gameId: string` 대신 `scope: InboxScope`.

- [ ] **Step 1: Write the failing tests**

`tests/lib/inquiry-filters.test.ts` — import에 스코프 헬퍼를 추가하고 `hrefs`·`inbox hrefs` describe 블록을 아래로 바꾼다:

```ts
import { SERVICE_SCOPE, gameScope } from "@/lib/inbox-scope";
```

```ts
describe("hrefs", () => {
  it("builds the list href with and without a query", () => {
    expect(inquiryListHref(gameScope("g1"), DEFAULT_QUERY)).toBe("/games/g1/inquiries");
    expect(inquiryListHref(gameScope("g1"), { ...DEFAULT_QUERY, status: "new" })).toBe("/games/g1/inquiries?status=new");
  });

  it("builds service inbox hrefs under /service", () => {
    expect(inquiryListHref(SERVICE_SCOPE, DEFAULT_QUERY)).toBe("/service/inquiries");
    expect(inquiryListHref(SERVICE_SCOPE, { ...DEFAULT_QUERY, status: "new" })).toBe("/service/inquiries?status=new");
    expect(inquiryHref(SERVICE_SCOPE, "i1", { ...DEFAULT_QUERY, page: 2 })).toBe("/service/inquiries/i1?page=2");
    expect(inboxHref(SERVICE_SCOPE, null, DEFAULT_QUERY)).toBe("/service/inquiries");
    expect(inboxHref(SERVICE_SCOPE, "i1", DEFAULT_QUERY)).toBe("/service/inquiries/i1");
    expect(legacyInquiryRedirectHref(SERVICE_SCOPE, "i1", "status=new")).toBe("/service/inquiries/i1?status=new");
  });
});
```

```ts
describe("inbox hrefs", () => {
  it("builds the inquiry href with the list query on the same URL", () => {
    expect(inquiryHref(gameScope("g1"), "i1", DEFAULT_QUERY)).toBe("/games/g1/inquiries/i1");
    expect(inquiryHref(gameScope("g1"), "i1", { ...DEFAULT_QUERY, status: "new", page: 2 })).toBe(
      "/games/g1/inquiries/i1?status=new&page=2"
    );
  });

  it("inboxHref keeps the selected inquiry when there is one", () => {
    expect(inboxHref(gameScope("g1"), null, { ...DEFAULT_QUERY, q: "x" })).toBe("/games/g1/inquiries?q=x");
    expect(inboxHref(gameScope("g1"), "i1", { ...DEFAULT_QUERY, q: "x" })).toBe("/games/g1/inquiries/i1?q=x");
  });

  it("legacy redirect decodes the old list param into the new URL", () => {
    expect(legacyInquiryRedirectHref(gameScope("g1"), "i1", undefined)).toBe("/games/g1/inquiries/i1");
    expect(legacyInquiryRedirectHref(gameScope("g1"), "i1", "status=new&sort=oldest")).toBe(
      "/games/g1/inquiries/i1?status=new&sort=oldest"
    );
    expect(legacyInquiryRedirectHref(gameScope("g1"), "i1", "status=bogus")).toBe("/games/g1/inquiries/i1");
  });
});
```

컴포넌트 테스트는 `gameId="g1"`을 `scope={gameScope("g1")}`로 바꾼다. 각 파일 상단에 `import { gameScope } from "@/lib/inbox-scope";`를 추가한다.

- `tests/components/InboxSearch.test.tsx` 15·20·28행: `<InboxSearch scope={gameScope("g1")} …`
- `tests/components/InboxPrevNext.test.tsx` 9·16·22·24행: `<InboxPrevNext scope={gameScope("g1")} …`
- `tests/components/InboxList.test.tsx` 53행: `<InboxList scope={gameScope("g1")} …`
- `tests/components/InboxConversation.test.tsx` 42행: `<InboxConversation scope={gameScope("g1")} …`

`tests/components/InboxPrevNext.test.tsx`에 서비스 스코프 케이스 하나를 추가한다:

```ts
import { SERVICE_SCOPE, gameScope } from "@/lib/inbox-scope";
```

```ts
  it("links under /service for the service inbox", () => {
    render(<InboxPrevNext scope={SERVICE_SCOPE} inquiryId="b" query={DEFAULT_QUERY} ids={["a", "b", "c"]} />);
    expect(screen.getByRole("link", { name: "이전 문의" })).toHaveAttribute("href", "/service/inquiries/a");
    expect(screen.getByRole("link", { name: "다음 문의" })).toHaveAttribute("href", "/service/inquiries/c");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/lib/inquiry-filters.test.ts tests/components/InboxPrevNext.test.tsx`
Expected: FAIL — href가 `/games/[object Object]/inquiries…`로 나온다.

- [ ] **Step 3: Change the helpers**

`lib/inquiry-filters.ts` — 상단 import 추가, 96행 이후의 헬퍼 4개를 교체:

```ts
import { scopeBasePath, type InboxScope } from "@/lib/inbox-scope";
```

```ts
/** 목록 화면으로 돌아가는 링크. */
export function inquiryListHref(scope: InboxScope, query: InquiryListQuery): string {
  const search = toInquiryListSearch(query);
  const base = `${scopeBasePath(scope)}/inquiries`;
  return search ? `${base}?${search}` : base;
}

/** 인박스에서 문의 하나를 연 URL. 목록 상태는 같은 URL의 쿼리로 남는다. */
export function inquiryHref(scope: InboxScope, inquiryId: string, query: InquiryListQuery): string {
  const search = toInquiryListSearch(query);
  const base = `${scopeBasePath(scope)}/inquiries/${inquiryId}`;
  return search ? `${base}?${search}` : base;
}

/** 선택된 문의가 있으면 유지한 채, 없으면 목록만 가리키는 URL. 필터·정렬·페이지 이동이 쓴다. */
export function inboxHref(scope: InboxScope, selectedId: string | null, query: InquiryListQuery): string {
  return selectedId ? inquiryHref(scope, selectedId, query) : inquiryListHref(scope, query);
}

/** 예전 /inquiries/{id}?list=... 링크를 새 URL로 옮긴다. Slack에 이미 나간 링크 호환용. */
export function legacyInquiryRedirectHref(
  scope: InboxScope,
  inquiryId: string,
  listParam: string | null | undefined
): string {
  return inquiryHref(scope, inquiryId, parseInquiryListQuery(listParam ?? ""));
}
```

- [ ] **Step 4: Change the components' props**

`components/inbox/InboxSearch.tsx`:

```ts
import { inboxHref, type InquiryListQuery } from "@/lib/inquiry-filters";
import type { InboxScope } from "@/lib/inbox-scope";
```
props `gameId` → `scope`:
```ts
export default function InboxSearch({
  scope,
  query,
  selectedId,
}: {
  scope: InboxScope;
  query: InquiryListQuery;
  selectedId: string | null;
}) {
```
38행: `router.replace(inboxHref(scope, selectedId, { ...query, q: next.trim(), page: 1 }));`

`components/inbox/InboxPrevNext.tsx`:

```ts
import type { InboxScope } from "@/lib/inbox-scope";
```
props `gameId: string` → `scope: InboxScope`; 36·48행의 `inquiryHref(gameId, …)` → `inquiryHref(scope, …)`.

`components/inbox/InboxList.tsx`:

```ts
import type { InboxScope } from "@/lib/inbox-scope";
```
props `gameId: string` → `scope: InboxScope`; 68행 `inboxHref(scope, selectedId, merged)`; 152행 `inquiryHref(scope, inquiry.id, query)`.

`components/inbox/InboxConversation.tsx`:

```ts
import type { InboxScope } from "@/lib/inbox-scope";
```
props `gameId: string` → `scope: InboxScope`; 54행 `<InboxPrevNext scope={scope} …`.

`components/inbox/InboxNav.tsx` — 이번 태스크에서는 내부 호출만 바꾼다(props는 Task 6):

```ts
import { gameScope } from "@/lib/inbox-scope";
```
```ts
  const href = (patch: Partial<InquiryListQuery>) => inboxHref(gameScope(game.id), selectedId, { ...query, ...patch, page: 1 });
```
65행: `<InboxSearch scope={gameScope(game.id)} query={query} selectedId={selectedId} />`

`components/inbox/InboxShell.tsx`:

```ts
import { gameScope } from "@/lib/inbox-scope";
```
```tsx
  const scope = gameScope(game.id);
  …
      <InboxList scope={scope} page={listPage} … />
      …
          <InboxConversation
            scope={scope}
```

`app/(admin)/inquiries/[id]/page.tsx` 25행:

```ts
import { scopeForGameId } from "@/lib/inbox-scope";
…
  redirect(legacyInquiryRedirectHref(scopeForGameId(inquiry.gameId), inquiry.id, listParam));
```

- [ ] **Step 5: Run tests and type check**

Run: `npm test -- tests/lib/inquiry-filters.test.ts tests/components/InboxSearch.test.tsx tests/components/InboxPrevNext.test.tsx tests/components/InboxList.test.tsx tests/components/InboxConversation.test.tsx tests/components/InboxNav.test.tsx && npx tsc --noEmit`
Expected: 모두 PASS, tsc 오류 없음.

- [ ] **Step 6: Commit**

```bash
git add lib/inquiry-filters.ts components/inbox app/\(admin\)/inquiries tests/lib/inquiry-filters.test.ts tests/components
git commit -m "refactor: inbox URL helpers and link components take an InboxScope"
```

---

### Task 3: 목록·id·건수 조회가 스코프로 `game_id` 조건을 만든다 + 마이그레이션 0009

**Files:**
- Modify: `lib/inquiries.ts:110-225, 273-280`
- Modify: `app/(admin)/games/[gameId]/inquiries/[[...inquiryId]]/page.tsx:41-46, 63`
- Create: `supabase/migrations/0009_service_inquiry_facets.sql`
- Test: `tests/lib/inquiries.test.ts`

**Interfaces:**
- Consumes: `InboxScope`, `gameScope`, `SERVICE_SCOPE`, `scopeGameId`, `SERVICE_RAIL_KEY` (Task 1)
- Produces:
  ```ts
  export async function queryInquiries(supabase, scope: InboxScope, query, options?): Promise<InquiryPage>;
  export async function listInquiryIds(supabase, scope: InboxScope, query, options?): Promise<string[]>;
  export async function getInquiryFacetCounts(supabase, scope: InboxScope): Promise<InquiryFacetCounts | null>;
  export async function countNewInquiriesByGame(supabase): Promise<Record<string, number>>; // 서비스 건수는 키 "service"
  ```

- [ ] **Step 1: Write the failing tests**

`tests/lib/inquiries.test.ts`:

상단 import 추가:
```ts
import { SERVICE_SCOPE, gameScope } from "@/lib/inbox-scope";
```

`mockBuilder`의 메서드 목록에 `"is"`를 추가:
```ts
  for (const name of ["eq", "neq", "lt", "or", "order", "range", "limit", "in", "is"]) {
```

기존 `queryInquiries`·`listInquiryIds`·`getInquiryFacetCounts` 호출의 두 번째 인자 `"game-1"`을 모두 `gameScope("game-1")`로 바꾼다(총 12곳). 그리고 아래 테스트를 추가한다.

`describe("queryInquiries")` 안에:
```ts
  it("service scope filters game_id is null instead of eq", async () => {
    const { from, calls } = mockBuilder({ data: [], count: 0 });

    await queryInquiries({ from } as never, SERVICE_SCOPE, { ...DEFAULT_QUERY, status: "new" });

    expect(calls.is).toEqual([["game_id", null]]);
    expect(calls.eq).toEqual([["status", "new"]]);
  });

  it("game scope never calls is()", async () => {
    const { from, calls } = mockBuilder({ data: [], count: 0 });
    await queryInquiries({ from } as never, gameScope("game-1"), DEFAULT_QUERY);
    expect(calls.is).toEqual([]);
  });
```

`describe("listInquiryIds")` 안에:
```ts
  it("service scope filters game_id is null", async () => {
    const { from, calls } = mockBuilder({ data: [{ id: "s1" }] });
    await expect(listInquiryIds({ from } as never, SERVICE_SCOPE, DEFAULT_QUERY)).resolves.toEqual(["s1"]);
    expect(calls.is).toEqual([["game_id", null]]);
    expect(calls.eq).toEqual([]);
  });
```

`describe("getInquiryFacetCounts")` 안에:
```ts
  it("passes p_game_id null for the service scope", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ facet: "total", key: "all", count: 3 }], error: null });
    const counts = await getInquiryFacetCounts({ rpc } as never, SERVICE_SCOPE);
    expect(rpc).toHaveBeenCalledWith("inquiry_facet_counts", { p_game_id: null });
    expect(counts?.total).toBe(3);
  });
```

`describe("countNewInquiriesByGame")`의 첫 테스트를 바꾼다:
```ts
  it("tallies new inquiries per game and counts game-less ones under 'service'", async () => {
    const eq = vi.fn().mockResolvedValue({
      data: [{ game_id: "g1" }, { game_id: "g1" }, { game_id: "g2" }, { game_id: null }, { game_id: null }],
      error: null,
    });
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));

    await expect(countNewInquiriesByGame({ from } as never)).resolves.toEqual({ g1: 2, g2: 1, service: 2 });
    expect(eq).toHaveBeenCalledWith("status", "new");
  });

  it("omits the service key when no game-less inquiry is new", async () => {
    const eq = vi.fn().mockResolvedValue({ data: [{ game_id: "g1" }], error: null });
    const from = vi.fn(() => ({ select: vi.fn(() => ({ eq })) }));
    await expect(countNewInquiriesByGame({ from } as never)).resolves.toEqual({ g1: 1 });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/lib/inquiries.test.ts`
Expected: FAIL — `calls.is`가 비어 있고, `countNewInquiriesByGame`에 `service` 키가 없다.

- [ ] **Step 3: Change `lib/inquiries.ts`**

import 추가:
```ts
import { SERVICE_RAIL_KEY, scopeGameId, type InboxScope } from "@/lib/inbox-scope";
```

`FilterBuilder`에 `is` 추가:
```ts
interface FilterBuilder {
  eq(column: string, value: string): FilterBuilder;
  is(column: string, value: null): FilterBuilder;
  neq(column: string, value: string): FilterBuilder;
  lt(column: string, value: string): FilterBuilder;
  or(filters: string): FilterBuilder;
  order(column: string, options: { ascending: boolean }): FilterBuilder;
  range(from: number, to: number): FilterBuilder;
  limit(count: number): FilterBuilder;
}
```

`applyFilters` 시그니처와 첫 줄:
```ts
function applyFilters<T extends FilterBuilder>(builder: T, scope: InboxScope, query: InquiryListQuery, now: Date): T {
  // 서비스 문의는 game_id가 null이라 eq로는 못 잡는다.
  const gameId = scopeGameId(scope);
  let next = (gameId ? builder.eq("game_id", gameId) : builder.is("game_id", null)) as T;
```

`queryInquiries`·`listInquiryIds`의 두 번째 매개변수를 `scope: InboxScope`로 바꾸고 `applyFilters(…, scope, query, now)`로 넘긴다.

`countNewInquiriesByGame` 본문:
```ts
/** 게임별 접수(new) 건수. 게임 레일의 배지가 쓴다. 게임 없는 서비스 문의는 SERVICE_RAIL_KEY로 센다. */
export async function countNewInquiriesByGame(supabase: SupabaseClient): Promise<Record<string, number>> {
  const { data, error } = await supabase.from("inquiries").select("game_id").eq("status", "new");
  if (error || !data) {
    return {};
  }
  const counts: Record<string, number> = {};
  for (const row of data as Array<{ game_id: string | null }>) {
    const key = row.game_id ?? SERVICE_RAIL_KEY;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
```

`getInquiryFacetCounts`:
```ts
export async function getInquiryFacetCounts(
  supabase: SupabaseClient,
  scope: InboxScope
): Promise<InquiryFacetCounts | null> {
  const { data, error } = await supabase.rpc("inquiry_facet_counts", { p_game_id: scopeGameId(scope) });
```

- [ ] **Step 4: Update the page call sites**

`app/(admin)/games/[gameId]/inquiries/[[...inquiryId]]/page.tsx`:
```ts
import { gameScope } from "@/lib/inbox-scope";
…
  const supabase = getSupabaseServerClient();
  const query = parseInquiryListQuery(searchParams);
  const scope = gameScope(params.gameId);

  const [games, labels, counts, listPage] = await Promise.all([
    listGames(supabase),
    listCategoryLabels(supabase, params.gameId),
    getInquiryFacetCounts(supabase, scope),
    queryInquiries(supabase, scope, query),
  ]);
```
63행: `listInquiryIds(supabase, scope, query),`

- [ ] **Step 5: Write migration 0009**

`supabase/migrations/0009_service_inquiry_facets.sql`:

```sql
-- 문의함 보기 건수 RPC가 p_game_id = null을 "게임 없는 서비스 문의(제휴·기타)"로 센다.
-- 0008은 game_id = p_game_id 비교라 null이면 항상 거짓이었다. "is not distinct from"
-- 대신 or로 푼 이유: 그 연산자는 btree 인덱스를 못 타지만 아래 형태는 game_id 인덱스를
-- 쓸 수 있다. 서명이 같아 create or replace로 덮어쓰며, 0008의 권한 설정은 그대로다.
-- 재실행 안전.

create or replace function inquiry_facet_counts(p_game_id uuid)
returns table (facet text, key text, count bigint)
language sql
stable
as $$
  with scoped as (
    select status, type_key, priority, created_at
    from inquiries
    where game_id = p_game_id
       or (p_game_id is null and game_id is null)
  )
  select 'status'::text, status::text, count(*) from scoped group by status
  union all
  select 'type', type_key, count(*) from scoped group by type_key
  union all
  select 'priority', coalesce(priority, 'normal'), count(*) from scoped group by 2
  union all
  select 'stale', '1', count(*) from scoped
    where status <> 'resolved' and created_at < now() - interval '72 hours'
  union all
  select 'total', 'all', count(*) from scoped
$$;

revoke execute on function inquiry_facet_counts(uuid) from public, anon, authenticated;
grant execute on function inquiry_facet_counts(uuid) to service_role;
```

- [ ] **Step 6: Run tests and type check**

Run: `npm test -- tests/lib/inquiries.test.ts && npx tsc --noEmit`
Expected: PASS, tsc 오류 없음.

- [ ] **Step 7: Commit**

```bash
git add lib/inquiries.ts tests/lib/inquiries.test.ts supabase/migrations/0009_service_inquiry_facets.sql "app/(admin)/games/[gameId]/inquiries/[[...inquiryId]]/page.tsx"
git commit -m "feat: inquiry queries and facet counts accept a service scope (game_id is null)"
```

---

### Task 4: 서비스 카테고리 라벨 + 마이그레이션 0010

**Files:**
- Modify: `lib/categories.ts` (`listCategoryLabels` 아래에 추가)
- Create: `supabase/migrations/0010_service_categories.sql`
- Test: `tests/lib/categories.test.ts`

**Interfaces:**
- Consumes: `InboxScope` (Task 1)
- Produces:
  ```ts
  export async function listServiceCategoryLabels(supabase: SupabaseClient): Promise<CategoryLabelMaps>;
  export async function listCategoryLabelsForScope(supabase: SupabaseClient, scope: InboxScope): Promise<CategoryLabelMaps>;
  ```

- [ ] **Step 1: Write the failing tests**

`tests/lib/categories.test.ts` — import를 바꾸고 파일 끝에 describe를 추가:

```ts
import {
  DEFAULT_CATEGORY_TEMPLATE,
  createDefaultCategoriesForGame,
  listCategoryLabels,
  listCategoryLabelsForScope,
  listGames,
  listServiceCategoryLabels,
} from "@/lib/categories";
import { SERVICE_SCOPE, gameScope } from "@/lib/inbox-scope";
```

```ts
describe("listServiceCategoryLabels", () => {
  function chain(result: { data: unknown; error: { message: string } | null }) {
    const builder: Record<string, unknown> = {};
    for (const name of ["eq", "in", "order"]) {
      builder[name] = vi.fn(() => builder);
    }
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return builder;
  }

  it("reads the global service groups and types in sort order", async () => {
    const groups = chain({
      data: [
        { id: "sg-1", key: "business", label_ko: "사업 제휴 문의" },
        { id: "sg-2", key: "other", label_ko: "기타 문의" },
      ],
      error: null,
    });
    const types = chain({
      data: [
        { key: "publishing", label_ko: "퍼블리싱 제휴", group_id: "sg-1" },
        { key: "press", label_ko: "언론·보도 문의", group_id: "sg-2" },
        { key: "marketing", label_ko: "마케팅 제휴", group_id: "sg-1" },
      ],
      error: null,
    });
    const from = vi.fn((table: string) => ({
      select: vi.fn(() => (table === "service_groups" ? groups : types)),
    }));

    const labels = await listServiceCategoryLabels({ from } as never);

    expect(from).toHaveBeenCalledWith("service_groups");
    expect(from).toHaveBeenCalledWith("service_types");
    expect(groups.eq).not.toHaveBeenCalled();
    expect(labels.groupLabels).toEqual({ business: "사업 제휴 문의", other: "기타 문의" });
    expect(labels.typeLabels.press).toBe("언론·보도 문의");
    expect(labels.typeOrder).toEqual(["publishing", "marketing", "press"]);
    expect(types.in).toHaveBeenCalledWith("group_id", ["sg-1", "sg-2"]);
  });

  it("returns empty maps when the groups query fails", async () => {
    const groups = chain({ data: null, error: { message: "boom" } });
    const from = vi.fn(() => ({ select: vi.fn(() => groups) }));
    await expect(listServiceCategoryLabels({ from } as never)).resolves.toEqual({ groupLabels: {}, typeLabels: {}, typeOrder: [] });
  });
});

describe("listCategoryLabelsForScope", () => {
  it("reads inquiry_groups for a game and service_groups for the service scope", async () => {
    const tables: string[] = [];
    const empty = () => {
      const builder: Record<string, unknown> = {};
      for (const name of ["eq", "in", "order"]) builder[name] = vi.fn(() => builder);
      builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
      return builder;
    };
    const from = vi.fn((table: string) => {
      tables.push(table);
      return { select: vi.fn(() => empty()) };
    });

    await listCategoryLabelsForScope({ from } as never, gameScope("game-1"));
    await listCategoryLabelsForScope({ from } as never, SERVICE_SCOPE);

    expect(tables).toEqual(["inquiry_groups", "service_groups"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/lib/categories.test.ts`
Expected: FAIL — `listServiceCategoryLabels is not a function`

- [ ] **Step 3: Implement**

`lib/categories.ts` — import 추가:
```ts
import type { InboxScope } from "@/lib/inbox-scope";
```

`listCategoryLabels` 함수 바로 아래에 추가:

```ts
/**
 * 서비스 문의(제휴·기타)의 전역 카테고리 라벨. 접수 폼 저장소가 만든
 * service_groups/service_types(마이그레이션 0010 사본)에서 읽는다. 게임과 무관하게
 * 하나뿐이라 game_id 조건이 없다. 실패하면 빈 맵 — 라벨은 부가 정보다.
 */
export async function listServiceCategoryLabels(supabase: SupabaseClient): Promise<CategoryLabelMaps> {
  const groupLabels: Record<string, string> = {};
  const typeLabels: Record<string, string> = {};
  const typeOrder: string[] = [];

  const { data: groups, error: groupsError } = await supabase
    .from("service_groups")
    .select("id, key, label_ko")
    .order("sort_order", { ascending: true });

  if (groupsError || !groups || groups.length === 0) {
    return { groupLabels, typeLabels, typeOrder };
  }

  for (const group of groups) {
    groupLabels[group.key] = group.label_ko;
  }

  const { data: types, error: typesError } = await supabase
    .from("service_types")
    .select("key, label_ko, group_id")
    .in(
      "group_id",
      groups.map((group) => group.id)
    )
    .order("sort_order", { ascending: true });

  if (!typesError && types) {
    for (const type of types) {
      typeLabels[type.key] = type.label_ko;
    }
    for (const group of groups) {
      for (const type of types) {
        if (type.group_id === group.id) typeOrder.push(type.key);
      }
    }
  }

  return { groupLabels, typeLabels, typeOrder };
}

/** 스코프에 맞는 라벨. 게임이면 그 게임의 카테고리, 서비스면 전역 서비스 카테고리. */
export async function listCategoryLabelsForScope(supabase: SupabaseClient, scope: InboxScope): Promise<CategoryLabelMaps> {
  return scope.kind === "game" ? listCategoryLabels(supabase, scope.gameId) : listServiceCategoryLabels(supabase);
}
```

- [ ] **Step 4: Write migration 0010**

`supabase/migrations/0010_service_categories.sql` — 접수 폼 저장소(`~/Documents/theplayplus/supabase/migrations/0003_service_categories.sql`)의 사본. 머리 주석만 다르다:

```sql
-- theplayplus-contact 저장소의 0003_service_categories.sql 사본. 공유 DB에는 이미
-- 적용돼 있어 여기서는 아무 일도 하지 않는다(if not exists / on conflict do nothing).
-- 이 저장소만 보고도 서비스 문의(제휴·기타) 카테고리 스키마를 알 수 있게 두는 기록이다.
-- 관리자 앱은 service-role로 읽으므로 아래 anon 정책은 접수 폼용이다. 재실행 안전.
create table if not exists service_groups (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,
  label_ko   text not null,
  label_zh   text,
  label_en   text,
  sort_order int  not null default 0
);

create table if not exists service_types (
  id                    uuid primary key default gen_random_uuid(),
  group_id              uuid not null references service_groups(id) on delete cascade,
  key                   text not null,
  label_ko              text not null,
  label_zh              text,
  label_en              text,
  requires_company_name boolean not null default false,
  allow_attachments     boolean not null default true,
  sort_order            int not null default 0,
  unique (group_id, key)
);

alter table service_groups enable row level security;
alter table service_types enable row level security;

drop policy if exists "Allow public read on service_groups" on service_groups;
create policy "Allow public read on service_groups"
  on service_groups for select
  to anon
  using (true);

drop policy if exists "Allow public read on service_types" on service_types;
create policy "Allow public read on service_types"
  on service_types for select
  to anon
  using (true);

insert into service_groups (key, label_ko, label_zh, label_en, sort_order) values
  ('business', '사업 제휴 문의', '业务合作咨询', 'Business Partnership', 0),
  ('other',    '기타 문의',     '其他咨询',     'Other', 1)
on conflict (key) do nothing;

insert into service_types (group_id, key, label_ko, label_zh, label_en, requires_company_name, allow_attachments, sort_order)
select g.id, t.key, t.label_ko, t.label_zh, t.label_en, t.requires_company_name, t.allow_attachments, t.sort_order
from (values
  ('business', 'publishing',  '퍼블리싱 제휴', '发行合作',   'Publishing',           true,  true, 0),
  ('business', 'marketing',   '마케팅 제휴',   '市场合作',   'Marketing',            true,  true, 1),
  ('business', 'investment',  '투자 문의',     '投资咨询',   'Investment',           true,  true, 2),
  ('other',    'press',       '언론·보도 문의', '媒体咨询',  'Press',                false, true, 0),
  ('other',    'general',     '일반 문의',     '一般咨询',   'General',              false, true, 1)
) as t(group_key, key, label_ko, label_zh, label_en, requires_company_name, allow_attachments, sort_order)
join service_groups g on g.key = t.group_key
on conflict (group_id, key) do nothing;
```

- [ ] **Step 5: Run tests and type check**

Run: `npm test -- tests/lib/categories.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/categories.ts tests/lib/categories.test.ts supabase/migrations/0010_service_categories.sql
git commit -m "feat: read service inquiry category labels from service_groups/service_types"
```

---

### Task 5: 과거 답변 조회가 스코프를 받는다

**Files:**
- Modify: `lib/replies.ts`
- Modify: `app/api/inquiries/[id]/suggest/route.ts:25` (호출부만)
- Test: `tests/lib/replies.test.ts`

**Interfaces:**
- Consumes: `InboxScope`, `scopeGameId`, `gameScope`, `SERVICE_SCOPE` (Task 1)
- Produces: `listRecentRepliesByType(supabase, scope: InboxScope, typeKey: string, limit = 3): Promise<string[]>`

- [ ] **Step 1: Write the failing tests**

`tests/lib/replies.test.ts` — `mockClient`를 `is`도 지원하게 바꾸고 호출을 스코프로 바꾼다:

```ts
import { describe, it, expect, vi } from "vitest";
import { listRecentRepliesByType } from "@/lib/replies";
import { SERVICE_SCOPE, gameScope } from "@/lib/inbox-scope";

function mockClient(data: unknown, error: { message: string } | null = null) {
  const limit = vi.fn().mockResolvedValue({ data, error });
  const order = vi.fn(() => ({ limit }));
  const not = vi.fn(() => ({ order }));
  const eqType = vi.fn(() => ({ not }));
  const eqGame = vi.fn(() => ({ eq: eqType }));
  const isGame = vi.fn(() => ({ eq: eqType }));
  const select = vi.fn(() => ({ eq: eqGame, is: isGame }));
  const from = vi.fn(() => ({ select }));
  return { from, select, eqGame, isGame, eqType, not, order, limit };
}
```

기존 4개 테스트의 `"game-1"`을 `gameScope("game-1")`로 바꾸고, 첫 테스트 뒤에 추가:

```ts
  it("service scope looks up replies where game_id is null", async () => {
    const { from, eqGame, isGame, eqType } = mockClient([{ reply_content: "제휴 제안 감사합니다" }]);

    const result = await listRecentRepliesByType({ from } as never, SERVICE_SCOPE, "publishing");

    expect(isGame).toHaveBeenCalledWith("game_id", null);
    expect(eqGame).not.toHaveBeenCalled();
    expect(eqType).toHaveBeenCalledWith("type_key", "publishing");
    expect(result).toEqual(["제휴 제안 감사합니다"]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/lib/replies.test.ts`
Expected: FAIL — `eqGame`이 `[object Object]`로 호출된다 / `isGame` 미호출.

- [ ] **Step 3: Implement**

`lib/replies.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { scopeGameId, type InboxScope } from "@/lib/inbox-scope";

/**
 * 같은 스코프(게임 하나 또는 서비스 문의)·같은 유형에서 이미 발송된 답변 본문.
 * 추천 프롬프트가 우리 팀 말투를 따라가게 하는 근거로 쓴다.
 *
 * lib/inquiries.ts에 넣지 않는 이유: 그 파일이 이미 커졌고, 이 조회는
 * 추천 기능만 쓴다.
 */
export async function listRecentRepliesByType(
  supabase: SupabaseClient,
  scope: InboxScope,
  typeKey: string,
  limit = 3
): Promise<string[]> {
  const gameId = scopeGameId(scope);
  const base = supabase.from("inquiries").select("reply_content");
  const scoped = gameId ? base.eq("game_id", gameId) : base.is("game_id", null);
  const { data, error } = await scoped
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

`app/api/inquiries/[id]/suggest/route.ts` 25행 — 타입이 맞도록 호출부만 바꾼다(라우트의 나머지 변경은 Task 10):
```ts
import { gameScope } from "@/lib/inbox-scope";
…
    listRecentRepliesByType(supabase, gameScope(inquiry.gameId), inquiry.typeKey),
```

- [ ] **Step 4: Run tests and type check**

Run: `npm test -- tests/lib/replies.test.ts tests/api/inquiry-suggest.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/replies.ts tests/lib/replies.test.ts "app/api/inquiries/[id]/suggest/route.ts"
git commit -m "feat: recent-reply lookup for suggestions accepts a service scope"
```

---

### Task 6: `InboxNav`가 스코프·제목을 받고 게임 전용 요소는 게임일 때만 그린다

**Files:**
- Modify: `components/inbox/InboxNav.tsx`
- Modify: `components/inbox/InboxShell.tsx` (InboxNav 호출부)
- Test: `tests/components/InboxNav.test.tsx`

**Interfaces:**
- Consumes: `InboxScope`, `SERVICE_SCOPE`, `gameScope` (Task 1)
- Produces: `InboxNav` props
  ```ts
  { scope: InboxScope; title: string; game: GameRow | null; query; labels; counts; selectedId }
  ```
  `game`은 게임 스코프에서만 non-null이며 상태 배지·템플릿 링크·삭제 버튼에만 쓴다.

- [ ] **Step 1: Write the failing tests**

`tests/components/InboxNav.test.tsx`:

import 추가:
```ts
import { SERVICE_SCOPE, gameScope } from "@/lib/inbox-scope";
```

`renderNav`를 바꾼다:
```ts
function renderNav(query: InquiryListQuery = DEFAULT_QUERY, c: InquiryFacetCounts | null = counts, selectedId: string | null = null) {
  return render(<InboxNav scope={gameScope("g1")} title={game.name} game={game} query={query} labels={labels} counts={c} selectedId={selectedId} />);
}

const serviceLabels = {
  groupLabels: { business: "사업 제휴 문의", other: "기타 문의" },
  typeLabels: { publishing: "퍼블리싱 제휴", press: "언론·보도 문의" },
  typeOrder: ["publishing", "press"],
};

function renderServiceNav(query: InquiryListQuery = DEFAULT_QUERY, selectedId: string | null = null) {
  return render(<InboxNav scope={SERVICE_SCOPE} title="서비스 문의" game={null} query={query} labels={serviceLabels} counts={counts} selectedId={selectedId} />);
}
```

describe 끝에 추가:
```ts
  describe("service scope", () => {
    it("shows the service title without a game status badge", () => {
      renderServiceNav();
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("서비스 문의");
      expect(screen.queryByText("서비스중")).not.toBeInTheDocument();
      expect(screen.queryByText("종료")).not.toBeInTheDocument();
      expect(screen.getByText("문의함 · 전체 23건")).toBeInTheDocument();
    });

    it("links views and types under /service/inquiries", () => {
      renderServiceNav({ ...DEFAULT_QUERY, sort: "oldest" }, "i1");
      expect(screen.getByRole("link", { name: /^접수/ })).toHaveAttribute("href", "/service/inquiries/i1?status=new&sort=oldest");
      const list = screen.getByRole("list", { name: "유형" });
      const links = within(list).getAllByRole("link");
      expect(links.map((l) => l.textContent)).toEqual(["퍼블리싱 제휴0", "언론·보도 문의0"]);
      expect(links[0]).toHaveAttribute("href", "/service/inquiries/i1?type=publishing&sort=oldest");
    });

    it("has no template link and no delete button", () => {
      renderServiceNav();
      expect(screen.queryByRole("link", { name: "답변 템플릿" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /삭제/ })).not.toBeInTheDocument();
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/components/InboxNav.test.tsx`
Expected: FAIL — `game`이 null이라 `game.name`에서 TypeError.

- [ ] **Step 3: Change `InboxNav`**

`components/inbox/InboxNav.tsx`:

import 정리:
```ts
import Link from "next/link";
import type { GameRow, CategoryLabelMaps } from "@/lib/categories";
import type { InquiryFacetCounts, InquiryPriority, InquiryStatus } from "@/lib/inquiries";
import { inboxHref, type InquiryListQuery } from "@/lib/inquiry-filters";
import type { InboxScope } from "@/lib/inbox-scope";
import InboxSearch from "@/components/inbox/InboxSearch";
import DeleteGameButton from "@/components/games/DeleteGameButton";
```

컴포넌트 시그니처와 머리글:
```tsx
/**
 * 문의함 보기 열. 각 항목은 현재 쿼리에서 해당 필터만 바꾼 링크다. 건수는 부가 정보라 없어도 그린다.
 * game은 게임 스코프에서만 오며 상태 배지·템플릿 링크·삭제 버튼에만 쓴다. 서비스 문의에는 그 셋이 없다.
 */
export default function InboxNav({
  scope,
  title,
  game,
  query,
  labels,
  counts,
  selectedId,
}: {
  scope: InboxScope;
  title: string;
  game: GameRow | null;
  query: InquiryListQuery;
  labels: CategoryLabelMaps;
  counts: InquiryFacetCounts | null;
  selectedId: string | null;
}) {
  const href = (patch: Partial<InquiryListQuery>) => inboxHref(scope, selectedId, { ...query, ...patch, page: 1 });

  return (
    <aside className="w-[224px] shrink-0 h-full bg-panel border-r border-line flex flex-col gap-4 px-3 py-4 overflow-y-auto" aria-label="문의함 보기">
      <div className="flex flex-col gap-1.5 px-1">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-base font-bold truncate">{title}</h1>
          {game && (
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium shrink-0 ${
                game.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-ground text-muted"
              }`}
            >
              {game.status === "active" ? "서비스중" : "종료"}
            </span>
          )}
        </div>
        <p className="text-xs text-muted">{counts ? `문의함 · 전체 ${counts.total}건` : "문의함"}</p>
      </div>

      <InboxSearch scope={scope} query={query} selectedId={selectedId} />
```

바닥 영역(기존 `<div className="flex-1" />` 이후)을 바꾼다:
```tsx
      <div className="flex-1" />

      {game && (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <Link href={`/games/${game.id}/templates`} className={`${ITEM} h-8 ${ITEM_IDLE}`}>
            답변 템플릿
          </Link>
          <div className="px-2.5">
            <DeleteGameButton gameId={game.id} gameName={game.name} inquiryCount={counts?.total ?? 0} />
          </div>
        </div>
      )}
    </aside>
```

Task 2에서 넣은 `gameScope` import는 지운다.

- [ ] **Step 4: Update `InboxShell`**

`components/inbox/InboxShell.tsx`의 InboxNav 호출:
```tsx
      <InboxNav scope={scope} title={game.name} game={game} query={query} labels={labels} counts={counts} selectedId={selectedId} />
```

- [ ] **Step 5: Run tests and type check**

Run: `npm test -- tests/components/InboxNav.test.tsx && npx tsc --noEmit`
Expected: PASS (기존 10 + 신규 3).

- [ ] **Step 6: Commit**

```bash
git add components/inbox/InboxNav.tsx components/inbox/InboxShell.tsx tests/components/InboxNav.test.tsx
git commit -m "feat: InboxNav renders a service scope without game-only controls"
```

---

### Task 7: `InboxDetailPanel`은 `history`가 null이면 계정 이력 탭을 숨긴다

**Files:**
- Modify: `components/inbox/InboxDetailPanel.tsx:26-55, 100-106`
- Test: `tests/components/InboxDetailPanel.test.tsx`

**Interfaces:**
- Produces: `InboxDetailPanel` prop `history: AccountHistoryEntry[] | null`. null이면 탭 목록 없이 상세만.

- [ ] **Step 1: Write the failing test**

`tests/components/InboxDetailPanel.test.tsx` describe 끝에 추가:

```ts
  it("hides the account history tab entirely when history is null (service inquiries)", () => {
    render(<InboxDetailPanel inquiry={{ ...inquiry, gameAccount: null, companyName: "플레이컴퍼니" }} events={events} history={null} />);
    expect(screen.queryByRole("tab", { name: /계정 이력/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByText("접수 정보")).toBeInTheDocument();
    expect(screen.getByText("회사명")).toBeInTheDocument();
    expect(screen.getByText("플레이컴퍼니")).toBeInTheDocument();
    expect(screen.queryByText("게임 계정")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/components/InboxDetailPanel.test.tsx`
Expected: FAIL — `history.length` TypeError.

- [ ] **Step 3: Implement**

`components/inbox/InboxDetailPanel.tsx`:

```tsx
/** 오른쪽 상세 패널. 처리 컨트롤·접수 정보·처리 기록과 계정 이력을 탭으로. history가 null이면(서비스 문의) 탭 없이 상세만. */
export default function InboxDetailPanel({
  inquiry,
  events,
  history,
}: {
  inquiry: InquiryRow;
  events: EventRow[];
  history: AccountHistoryEntry[] | null;
}) {
  const [tab, setTab] = useState<Tab>("detail");
  const rows = inquiryMetaRows(inquiry);
  const showHistory = history !== null && tab === "history";
```

탭 헤더를 조건부로:
```tsx
      {history !== null && (
        <div className="flex items-center gap-1 h-[52px] px-3 border-b border-line shrink-0" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "detail"} onClick={() => setTab("detail")} className={tabClass(tab === "detail")}>
            상세
          </button>
          <button type="button" role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")} className={tabClass(tab === "history")}>
            계정 이력
            <span className="inline-flex min-w-[18px] h-4 px-1.5 rounded-full bg-ground text-muted text-[11px] leading-4 justify-center font-normal">
              {history.length}
            </span>
          </button>
        </div>
      )}
```

본문 분기 `{tab === "detail" ? (` → `{!showHistory ? (`, 그리고 이력 분기:
```tsx
        ) : (
          <div className="px-4 py-3.5">
            <AccountHistoryPanel history={history ?? []} gameAccount={inquiry.gameAccount} currentTypeKey={inquiry.typeKey} gameId={inquiry.gameId} frameless />
          </div>
        )}
```

- [ ] **Step 4: Run tests and type check**

Run: `npm test -- tests/components/InboxDetailPanel.test.tsx && npx tsc --noEmit`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add components/inbox/InboxDetailPanel.tsx tests/components/InboxDetailPanel.test.tsx
git commit -m "feat: detail panel drops the account history tab when there is no history source"
```

---

### Task 8: 게임 레일의 "서비스 문의" 타일

**Files:**
- Modify: `components/layout/GameRail.tsx:43-85`
- Test: `tests/components/GameRail.test.tsx` (신규)

**Interfaces:**
- Consumes: `SERVICE_RAIL_KEY`, `SERVICE_SCOPE_TITLE` (Task 1), `newCounts["service"]` (Task 3)

- [ ] **Step 1: Write the failing test**

`tests/components/GameRail.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import GameRail from "@/components/layout/GameRail";
import type { GameRow } from "@/lib/categories";

let pathname = "/games/g1/inquiries";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
// next/image는 jsdom에서 로더 설정을 요구한다. 레일 테스트에는 img면 충분하다.
// unoptimized는 img가 모르는 prop이라 떼어낸다.
vi.mock("next/image", () => ({
  default: ({ unoptimized: _unoptimized, ...props }: { unoptimized?: boolean; src: string; alt: string }) => <img {...props} />,
}));
vi.mock("@/components/games/GameForm", () => ({ default: () => <div data-testid="game-form" /> }));
vi.mock("@/lib/supabase-browser", () => ({ getSupabaseBrowserClient: () => ({ auth: { signOut: vi.fn() } }) }));

const games: GameRow[] = [
  { id: "g1", name: "아르카나 사가", status: "active", logoPath: null, ownerName: null, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "g2", name: "여신의 검", status: "ended", logoPath: null, ownerName: null, createdAt: "2026-01-02T00:00:00.000Z" },
];

describe("GameRail", () => {
  beforeEach(() => {
    pathname = "/games/g1/inquiries";
  });

  it("puts the service inquiry tile before every game and links it to /service/inquiries", () => {
    render(<GameRail games={games} newCounts={{ g1: 2 }} />);
    const nav = screen.getByRole("navigation", { name: "게임 목록" });
    const links = within(nav).getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", "/service/inquiries");
    expect(links[0]).toHaveAttribute("title", "서비스 문의 (제휴·기타)");
    expect(links[1]).toHaveAttribute("href", "/games/g1/inquiries");
    expect(links[2]).toHaveAttribute("href", "/games/g2/inquiries");
  });

  it("shows the new-inquiry badge on the service tile from newCounts.service", () => {
    render(<GameRail games={games} newCounts={{ service: 3, g1: 2 }} />);
    const service = screen.getByRole("link", { name: /서비스 문의/ });
    expect(within(service).getByLabelText("접수 3건")).toHaveTextContent("3");
    expect(service).toHaveAttribute("title", "서비스 문의 (제휴·기타) · 접수 3건");
  });

  it("has no badge when nothing is new for the service inbox", () => {
    render(<GameRail games={games} newCounts={{ g1: 2 }} />);
    const service = screen.getByRole("link", { name: /서비스 문의/ });
    expect(within(service).queryByLabelText(/접수/)).not.toBeInTheDocument();
  });

  // 로고 없는 게임 타일의 접근성 이름은 첫 글자("아")뿐이라 title로 찾는다.
  it("marks the service tile current under /service/ and the game tile under /games/{id}/", () => {
    pathname = "/service/inquiries/i1?status=new";
    const { unmount } = render(<GameRail games={games} />);
    expect(screen.getByRole("link", { name: /서비스 문의/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByTitle("아르카나 사가")).not.toHaveAttribute("aria-current");
    unmount();

    pathname = "/games/g2/inquiries";
    render(<GameRail games={games} />);
    expect(screen.getByRole("link", { name: /서비스 문의/ })).not.toHaveAttribute("aria-current");
    expect(screen.getByTitle("여신의 검")).toHaveAttribute("aria-current", "page");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/components/GameRail.test.tsx`
Expected: FAIL — 첫 링크의 href가 `/games/g1/inquiries`이고 "서비스 문의" 링크가 없다.

- [ ] **Step 3: Implement**

`components/layout/GameRail.tsx`:

import 추가:
```ts
import { SERVICE_RAIL_KEY, SERVICE_SCOPE_TITLE } from "@/lib/inbox-scope";
```

`<nav …>` 안, `{games.map(` 앞에 서비스 타일과 구분선을 넣는다. 게임 타일과 같은 링 스타일을 쓰되 로고 자리는 봉투 아이콘이다:

```tsx
        <nav className="flex-1 w-full overflow-y-auto flex flex-col items-center gap-2" aria-label="게임 목록">
          {(() => {
            const active = pathname.startsWith("/service/");
            const pending = newCounts[SERVICE_RAIL_KEY] ?? 0;
            const label = `${SERVICE_SCOPE_TITLE} (제휴·기타)`;
            return (
              <Link
                href="/service/inquiries"
                title={pending > 0 ? `${label} · 접수 ${pending}건` : label}
                aria-current={active ? "page" : undefined}
                className={`relative w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                  active
                    ? "ring-2 ring-accent ring-offset-2 ring-offset-panel"
                    : "opacity-70 hover:opacity-100 hover:ring-2 hover:ring-line hover:ring-offset-2 hover:ring-offset-panel"
                }`}
              >
                <span className="w-10 h-10 bg-ground border border-line rounded-xl flex items-center justify-center text-muted">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <path d="M3 7l9 6 9-6" />
                  </svg>
                  <span className="sr-only">{SERVICE_SCOPE_TITLE}</span>
                </span>
                {pending > 0 && (
                  <span
                    className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-white text-[10px] font-semibold leading-[18px] text-center ring-2 ring-panel"
                    aria-label={`접수 ${pending}건`}
                  >
                    {pending > 99 ? "99+" : pending}
                  </span>
                )}
              </Link>
            );
          })()}

          <div className="w-8 border-t border-line my-1" aria-hidden="true" />

          {games.map((game) => {
```

즉시실행 함수가 어색하면 같은 파일 안에 `function ServiceTile({ active, pending }: { active: boolean; pending: number })` 컴포넌트로 빼서 `<ServiceTile active={pathname.startsWith("/service/")} pending={newCounts[SERVICE_RAIL_KEY] ?? 0} />`로 써도 된다. 마크업은 위와 같아야 한다.

- [ ] **Step 4: Run tests and type check**

Run: `npm test -- tests/components/GameRail.test.tsx && npx tsc --noEmit`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add components/layout/GameRail.tsx tests/components/GameRail.test.tsx
git commit -m "feat: pin a service inquiry tile to the top of the game rail"
```

---

### Task 9: Slack 알림이 `game_id` null(서비스 문의)을 받는다

**Files:**
- Modify: `app/api/notify/inquiry/route.ts`
- Test: `tests/api/notify-inquiry.test.ts`

**Interfaces:**
- Consumes: `scopeForGameId`, `scopeBasePath`, `SERVICE_SCOPE_TITLE` (Task 1), `listCategoryLabelsForScope` (Task 4)

- [ ] **Step 1: Write the failing tests**

`tests/api/notify-inquiry.test.ts`:

categories mock을 바꾼다:
```ts
vi.mock("@/lib/categories", () => ({ listCategoryLabelsForScope: vi.fn() }));
```
`beforeEach`와 "falls back…" 테스트의 `categoriesModule.listCategoryLabels`를 `categoriesModule.listCategoryLabelsForScope`로 바꾼다(2곳).

describe 끝에 추가:
```ts
  it("notifies service inquiries (game_id null) with a service label and a /service link", async () => {
    vi.mocked(categoriesModule.listCategoryLabelsForScope).mockResolvedValue({
      groupLabels: { business: "사업 제휴 문의" },
      typeLabels: { publishing: "퍼블리싱 제휴" },
      typeOrder: ["publishing"],
    });
    const client = mockSupabase();

    const response = await POST(
      makeRequest({
        type: "INSERT",
        table: "inquiries",
        record: { ...record, game_id: null, group_key: "business", type_key: "publishing", game_account: null, title: "퍼블리싱 제안" },
      })
    );

    expect(response.status).toBe(200);
    expect(client.from).not.toHaveBeenCalledWith("games");
    expect(categoriesModule.listCategoryLabelsForScope).toHaveBeenCalledWith(expect.anything(), { kind: "service" });
    const [, message] = vi.mocked(slackModule.sendSlackMessage).mock.calls[0];
    expect(message.text).toBe("[서비스 문의] 새 문의 · 사업 제휴 문의 > 퍼블리싱 제휴 · 퍼블리싱 제안");
    expect(JSON.stringify(message.blocks)).toContain("https://admin.theplayplus.com/service/inquiries/inq-1");
  });

  it("still accepts payloads that omit game_id entirely", async () => {
    const { game_id: _omitted, ...withoutGame } = record;
    const response = await POST(makeRequest({ type: "INSERT", table: "inquiries", record: withoutGame }));
    expect(response.status).toBe(200);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/api/notify-inquiry.test.ts`
Expected: FAIL — 새 테스트 2개가 400을 받는다(기존 것은 mock 이름 변경 때문에 실패할 수 있다. 다음 단계 후 전부 통과해야 한다).

- [ ] **Step 3: Implement**

`app/api/notify/inquiry/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase";
import { listCategoryLabelsForScope, type CategoryLabelMaps } from "@/lib/categories";
import { SERVICE_SCOPE_TITLE, scopeBasePath, scopeForGameId } from "@/lib/inbox-scope";
import { buildInquirySlackMessage, sendSlackMessage } from "@/lib/slack";
```
(기존 import 중 `listCategoryLabels`만 빼고 나머지는 그대로 둔다.)

스키마:
```ts
    game_id: z.string().nullish(),
```

본문의 라벨·게임명 조회부터 메시지 생성까지:
```ts
  const { record } = parsed.data;
  const supabase = getSupabaseServerClient();
  const scope = scopeForGameId(record.game_id ?? null);
  const EMPTY: CategoryLabelMaps = { groupLabels: {}, typeLabels: {}, typeOrder: [] };

  // 라벨·게임명 조회는 부가 정보다. 실패하면 키를 그대로 보여주고 알림은 계속 보낸다.
  // 서비스 문의(game_id null)는 게임이 없으므로 게임명 대신 고정 제목을 쓴다.
  const [gameName, labels] = await Promise.all([
    scope.kind === "game"
      ? supabase
          .from("games")
          .select("name")
          .eq("id", scope.gameId)
          .single()
          .then((result) => result.data?.name ?? "알 수 없는 게임")
      : Promise.resolve(SERVICE_SCOPE_TITLE),
    listCategoryLabelsForScope(supabase, scope).catch((): CategoryLabelMaps => EMPTY),
  ]);

  const message = buildInquirySlackMessage({
    gameName,
    inquiryNo: record.inquiry_no ?? null,
    groupLabel: labels.groupLabels[record.group_key] ?? record.group_key,
    typeLabel: labels.typeLabels[record.type_key] ?? record.type_key,
    title: record.title,
    gameAccount: record.game_account ?? null,
    detailUrl: `${new URL(request.url).origin}${scopeBasePath(scope)}/inquiries/${record.id}`,
  });
```

- [ ] **Step 4: Run tests and type check**

Run: `npm test -- tests/api/notify-inquiry.test.ts && npx tsc --noEmit`
Expected: PASS (기존 8 + 신규 2).

- [ ] **Step 5: Commit**

```bash
git add app/api/notify/inquiry/route.ts tests/api/notify-inquiry.test.ts
git commit -m "feat: Slack notification handles service inquiries without a game"
```

---

### Task 10: 답변 추천·답변 발송 라우트가 게임 없는 문의에서 동작한다

**Files:**
- Modify: `app/api/inquiries/[id]/suggest/route.ts`
- Modify: `app/api/inquiries/[id]/reply/route.ts:9, 52-56`
- Test: `tests/api/inquiry-suggest.test.ts`, `tests/api/inquiry-reply.test.ts`

**Interfaces:**
- Consumes: `scopeForGameId` (Task 1), `listCategoryLabelsForScope` (Task 4), `listRecentRepliesByType(supabase, scope, typeKey)` (Task 5)

이 태스크의 코드는 `inquiry.gameId`가 아직 `string`이어도 컴파일된다. Task 11에서 nullable로 바뀌어도 그대로 동작해야 한다.

- [ ] **Step 1: Write the failing tests**

`tests/api/inquiry-suggest.test.ts`:

categories mock:
```ts
vi.mock("@/lib/categories", () => ({ listCategoryLabelsForScope: vi.fn(), listGames: vi.fn() }));
```
`beforeEach`의 `categoriesModule.listCategoryLabels` → `categoriesModule.listCategoryLabelsForScope`.

describe 끝에 추가:
```ts
  it("suggests for a service inquiry without a game: no templates, blank game name, service scope lookups", async () => {
    vi.mocked(inquiriesModule.getInquiryById).mockResolvedValue({
      ...inquiry,
      gameId: null,
      gameAccount: null,
      companyName: "플레이컴퍼니",
      groupKey: "business",
      typeKey: "publishing",
    } as never);
    vi.mocked(categoriesModule.listCategoryLabelsForScope).mockResolvedValue({
      groupLabels: { business: "사업 제휴 문의" },
      typeLabels: { publishing: "퍼블리싱 제휴" },
      typeOrder: ["publishing"],
    });

    const response = await POST(suggestRequest(), { params: { id: "inq-1" } });

    expect(response.status).toBe(200);
    expect(templatesModule.listTemplates).not.toHaveBeenCalled();
    expect(categoriesModule.listCategoryLabelsForScope).toHaveBeenCalledWith(expect.anything(), { kind: "service" });
    expect(repliesModule.listRecentRepliesByType).toHaveBeenCalledWith(expect.anything(), { kind: "service" }, "publishing");
    expect(suggestModule.streamSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        gameName: "",
        groupLabel: "사업 제휴 문의",
        typeLabel: "퍼블리싱 제휴",
        companyName: "플레이컴퍼니",
        templates: [],
      })
    );
  });
```

`tests/api/inquiry-reply.test.ts` — `mockFetchInquiry`의 `from`에 서비스 테이블을 추가한다:

```ts
    const serviceGroupsSelect = vi.fn(() => ({
      order: vi.fn().mockResolvedValue({ data: [{ id: "sg-1", key: "business", label_ko: "사업 제휴 문의" }], error: null }),
    }));
    const serviceTypesSelect = vi.fn(() => ({
      in: vi.fn(() => ({
        order: vi.fn().mockResolvedValue({ data: [{ key: "publishing", label_ko: "퍼블리싱 제휴", group_id: "sg-1" }], error: null }),
      })),
    }));

    const from = vi.fn((table: string) => {
      if (table === "games") return { select: gameSelect };
      if (table === "inquiry_groups") return { select: groupsSelect };
      if (table === "inquiry_types") return { select: typesSelect };
      if (table === "service_groups") return { select: serviceGroupsSelect };
      if (table === "service_types") return { select: serviceTypesSelect };
      return { select, update };
    });
```

describe 끝에 추가:
```ts
  it("labels a service inquiry (game_id null) with the service category and no game name", async () => {
    mockFetchInquiry({
      id: "inq-1",
      reply_email: "partner@example.com",
      title: "퍼블리싱 제안",
      game_id: null,
      group_key: "business",
      type_key: "publishing",
    });
    vi.mocked(gmailModule.sendReplyEmail).mockResolvedValue(SENT);

    const response = await POST(jsonRequest({ replyContent: "제안 감사합니다" }), { params: { id: "inq-1" } });

    expect(response.status).toBe(200);
    const sendInput = vi.mocked(gmailModule.sendReplyEmail).mock.calls[0][0];
    expect(sendInput.body).toContain("문의 유형: 사업 제휴 문의 · 퍼블리싱 제휴");
    expect(sendInput.html).toContain("퍼블리싱 제휴");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/api/inquiry-suggest.test.ts tests/api/inquiry-reply.test.ts`
Expected: FAIL — suggest는 `listTemplates`가 호출되고 스코프가 `{kind:"game"}`; reply는 본문에 "문의 유형"이 없다.

- [ ] **Step 3: Change the suggest route**

`app/api/inquiries/[id]/suggest/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { getInquiryById } from "@/lib/inquiries";
import { listCategoryLabelsForScope, listGames } from "@/lib/categories";
import { scopeForGameId } from "@/lib/inbox-scope";
import { listTemplates, type TemplateRow } from "@/lib/templates";
import { listRecentRepliesByType } from "@/lib/replies";
import { streamSuggestion, type SuggestEvent } from "@/lib/suggest";
```

조회부:
```ts
  // 서비스 문의(game_id null)는 게임·템플릿이 없다. 라벨과 과거 답변은 서비스 스코프로 찾는다.
  const scope = scopeForGameId(inquiry.gameId);
  const [labels, games, templates, pastReplies] = await Promise.all([
    listCategoryLabelsForScope(supabase, scope),
    scope.kind === "game" ? listGames(supabase) : Promise.resolve([]),
    scope.kind === "game" ? listTemplates(supabase, scope.gameId) : Promise.resolve([] as TemplateRow[]),
    listRecentRepliesByType(supabase, scope, inquiry.typeKey),
  ]);

  const game = scope.kind === "game" ? games.find((entry) => entry.id === scope.gameId) : undefined;
```
Task 5에서 넣은 `gameScope` import는 지운다. `lib/templates.ts`가 `TemplateRow`를 export하지 않으면 `Awaited<ReturnType<typeof listTemplates>>`로 대신한다.

- [ ] **Step 4: Change the reply route**

`app/api/inquiries/[id]/reply/route.ts`:

```ts
import { listCategoryLabelsForScope, type CategoryLabelMaps } from "@/lib/categories";
import { scopeForGameId } from "@/lib/inbox-scope";
```
52–56행:
```ts
  const [references, gameName, labels] = await Promise.all([
    listRfcMessageIds(supabase, params.id).catch(() => [] as string[]),
    inquiry.game_id ? fetchGameName(supabase, inquiry.game_id).catch(() => null) : Promise.resolve(null),
    listCategoryLabelsForScope(supabase, scopeForGameId(inquiry.game_id ?? null)).catch(() => EMPTY_LABELS),
  ]);
```

- [ ] **Step 5: Run tests and type check**

Run: `npm test -- tests/api/inquiry-suggest.test.ts tests/api/inquiry-reply.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "app/api/inquiries/[id]/suggest/route.ts" "app/api/inquiries/[id]/reply/route.ts" tests/api/inquiry-suggest.test.ts tests/api/inquiry-reply.test.ts
git commit -m "feat: reply and suggestion routes work for service inquiries without a game"
```

---

### Task 11: `InquiryRow.gameId` nullable, 공용 페이지 로더, 서비스 인박스 라우트

**Files:**
- Modify: `lib/inquiries.ts:10, 44, 68`
- Create: `lib/inbox-page.ts`
- Modify: `app/(admin)/games/[gameId]/inquiries/[[...inquiryId]]/page.tsx` (전체 교체)
- Create: `app/(admin)/service/inquiries/[[...inquiryId]]/page.tsx`
- Modify: `components/inbox/InboxShell.tsx`
- Modify: `components/inbox/InboxDetailPanel.tsx:105` (gameId 좁히기)
- Test: `tests/lib/inbox-page.test.ts` (신규)

**Interfaces:**
- Consumes: 모든 이전 태스크.
- Produces:
  ```ts
  // lib/inbox-page.ts
  export interface InboxPageData {
    scope: InboxScope;
    title: string;
    game: GameRow | null;
    query: InquiryListQuery;
    labels: CategoryLabelMaps;
    counts: InquiryFacetCounts | null;
    listPage: InquiryPage;
    selected: InboxSelection | null;
  }
  /** 스코프의 게임이 없거나, 선택한 문의가 없거나 스코프 밖이면 null → 페이지가 notFound(). */
  export async function loadInboxPage(
    supabase: SupabaseClient,
    scope: InboxScope,
    inquiryId: string | null,
    searchParams: Record<string, string | string[] | undefined>
  ): Promise<InboxPageData | null>;
  ```
  `InboxShell` props: `{ scope, title, game: GameRow | null, query, labels, counts, listPage, selected }`. `InboxSelection.history`는 `AccountHistoryEntry[] | null`.

- [ ] **Step 1: Write the failing test**

`tests/lib/inbox-page.test.ts` — 로더의 분기(게임 조회·스코프 검증·서비스 스코프에서 이력/템플릿 생략)를 모듈 mock으로 검증한다:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadInboxPage } from "@/lib/inbox-page";
import { SERVICE_SCOPE, gameScope } from "@/lib/inbox-scope";
import * as inquiriesModule from "@/lib/inquiries";
import * as categoriesModule from "@/lib/categories";
import * as historyModule from "@/lib/account-history";
import * as notesModule from "@/lib/notes";
import * as eventsModule from "@/lib/events";
import * as templatesModule from "@/lib/templates";
import * as messagesModule from "@/lib/messages";

vi.mock("@/lib/inquiries", () => ({
  getInquiryById: vi.fn(),
  getInquiryFacetCounts: vi.fn(),
  listAttachmentSignedUrls: vi.fn(),
  listInquiryIds: vi.fn(),
  queryInquiries: vi.fn(),
}));
vi.mock("@/lib/categories", () => ({ listCategoryLabelsForScope: vi.fn(), listGames: vi.fn() }));
vi.mock("@/lib/account-history", () => ({ getAccountHistory: vi.fn() }));
vi.mock("@/lib/notes", () => ({ listNotes: vi.fn(), listNotesByInquiryIds: vi.fn() }));
vi.mock("@/lib/events", () => ({ listEvents: vi.fn() }));
vi.mock("@/lib/templates", () => ({ listTemplates: vi.fn() }));
vi.mock("@/lib/messages", () => ({ listMessages: vi.fn(), listMessagesByInquiryIds: vi.fn() }));

const game = { id: "g1", name: "아르카나 사가", status: "active" as const, logoPath: null, ownerName: null, createdAt: "2026-01-01T00:00:00.000Z" };
const labels = { groupLabels: {}, typeLabels: {}, typeOrder: [] };
const emptyPage = { rows: [], total: 0, page: 1, pageSize: 50 };

function inquiry(overrides: Partial<inquiriesModule.InquiryRow>): inquiriesModule.InquiryRow {
  return {
    id: "inq-1",
    inquiryNo: null,
    gameId: "g1",
    groupKey: "game_usage",
    typeKey: "bug_report",
    gameAccount: "player1",
    companyName: null,
    replyEmail: "a@b.com",
    title: "제목",
    content: "내용",
    status: "new",
    priority: "normal",
    meta: {},
    draftReply: null,
    replyContent: null,
    repliedAt: null,
    gmailThreadId: null,
    locale: null,
    paymentNo: null,
    occurredAt: null,
    deviceInfo: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("loadInboxPage", () => {
  beforeEach(() => {
    vi.mocked(categoriesModule.listGames).mockReset().mockResolvedValue([game]);
    vi.mocked(categoriesModule.listCategoryLabelsForScope).mockReset().mockResolvedValue(labels);
    vi.mocked(inquiriesModule.getInquiryFacetCounts).mockReset().mockResolvedValue(null);
    vi.mocked(inquiriesModule.queryInquiries).mockReset().mockResolvedValue(emptyPage);
    vi.mocked(inquiriesModule.listInquiryIds).mockReset().mockResolvedValue(["inq-1"]);
    vi.mocked(inquiriesModule.listAttachmentSignedUrls).mockReset().mockResolvedValue([]);
    vi.mocked(inquiriesModule.getInquiryById).mockReset();
    vi.mocked(historyModule.getAccountHistory).mockReset().mockResolvedValue([]);
    vi.mocked(notesModule.listNotes).mockReset().mockResolvedValue([]);
    vi.mocked(notesModule.listNotesByInquiryIds).mockReset().mockResolvedValue({});
    vi.mocked(eventsModule.listEvents).mockReset().mockResolvedValue([]);
    vi.mocked(templatesModule.listTemplates).mockReset().mockResolvedValue([]);
    vi.mocked(messagesModule.listMessages).mockReset().mockResolvedValue([]);
    vi.mocked(messagesModule.listMessagesByInquiryIds).mockReset().mockResolvedValue({});
  });

  it("returns null for an unknown game", async () => {
    await expect(loadInboxPage({} as never, gameScope("nope"), null, {})).resolves.toBeNull();
  });

  it("loads a game inbox with the game row and its title", async () => {
    const data = await loadInboxPage({} as never, gameScope("g1"), null, { status: "new" });
    expect(data).toMatchObject({ title: "아르카나 사가", game, selected: null });
    expect(data?.query.status).toBe("new");
    expect(inquiriesModule.queryInquiries).toHaveBeenCalledWith({}, { kind: "game", gameId: "g1" }, expect.objectContaining({ status: "new" }));
    expect(categoriesModule.listCategoryLabelsForScope).toHaveBeenCalledWith({}, { kind: "game", gameId: "g1" });
  });

  it("loads the service inbox without looking up games", async () => {
    const data = await loadInboxPage({} as never, SERVICE_SCOPE, null, {});
    expect(data).toMatchObject({ title: "서비스 문의", game: null });
    expect(categoriesModule.listGames).not.toHaveBeenCalled();
    expect(inquiriesModule.getInquiryFacetCounts).toHaveBeenCalledWith({}, { kind: "service" });
  });

  it("returns null when the selected inquiry is missing or outside the scope", async () => {
    vi.mocked(inquiriesModule.getInquiryById).mockResolvedValue(null);
    await expect(loadInboxPage({} as never, gameScope("g1"), "inq-1", {})).resolves.toBeNull();

    vi.mocked(inquiriesModule.getInquiryById).mockResolvedValue(inquiry({ gameId: "g2" }));
    await expect(loadInboxPage({} as never, gameScope("g1"), "inq-1", {})).resolves.toBeNull();

    vi.mocked(inquiriesModule.getInquiryById).mockResolvedValue(inquiry({ gameId: "g1" }));
    await expect(loadInboxPage({} as never, SERVICE_SCOPE, "inq-1", {})).resolves.toBeNull();
  });

  it("game scope: loads history, past threads, and templates for the selected inquiry", async () => {
    vi.mocked(inquiriesModule.getInquiryById).mockResolvedValue(inquiry({}));
    vi.mocked(historyModule.getAccountHistory).mockResolvedValue([
      { id: "inq-0", inquiryNo: null, title: "예전", content: "…", status: "resolved", groupKey: "game_usage", typeKey: "bug_report", occurredAt: null, paymentNo: null, deviceInfo: null, createdAt: "2026-08-01T00:00:00.000Z" },
    ]);

    const data = await loadInboxPage({} as never, gameScope("g1"), "inq-1", {});

    expect(historyModule.getAccountHistory).toHaveBeenCalledWith({}, "g1", "player1", "inq-1");
    expect(templatesModule.listTemplates).toHaveBeenCalledWith({}, "g1");
    expect(data?.selected?.history).toHaveLength(1);
    expect(data?.selected?.pastThreads).toHaveLength(1);
    expect(data?.selected?.pastThreads[0].inquiry.id).toBe("inq-0");
    expect(data?.selected?.siblingIds).toEqual(["inq-1"]);
  });

  it("service scope: skips history and templates and hands the panel a null history", async () => {
    vi.mocked(inquiriesModule.getInquiryById).mockResolvedValue(inquiry({ gameId: null, gameAccount: null, companyName: "플레이컴퍼니" }));

    const data = await loadInboxPage({} as never, SERVICE_SCOPE, "inq-1", {});

    expect(historyModule.getAccountHistory).not.toHaveBeenCalled();
    expect(templatesModule.listTemplates).not.toHaveBeenCalled();
    expect(data?.selected).toMatchObject({ history: null, pastThreads: [], templates: [] });
    expect(inquiriesModule.listInquiryIds).toHaveBeenCalledWith({}, { kind: "service" }, expect.anything());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/inbox-page.test.ts`
Expected: FAIL — `@/lib/inbox-page` 없음.

- [ ] **Step 3: Make `InquiryRow.gameId` nullable**

`lib/inquiries.ts`:
- 10행 `gameId: string;` → `gameId: string | null;` 주석: `/** 서비스 문의(제휴·기타)는 게임이 없어 null. */`
- 44행 `mapInquiryRow`의 `game_id: string;` → `game_id: string | null;`
- 68행은 그대로(`gameId: row.game_id`).

- [ ] **Step 4: Write `lib/inbox-page.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getInquiryById,
  getInquiryFacetCounts,
  listAttachmentSignedUrls,
  listInquiryIds,
  queryInquiries,
  type InquiryFacetCounts,
  type InquiryPage,
} from "@/lib/inquiries";
import { parseInquiryListQuery, type InquiryListQuery } from "@/lib/inquiry-filters";
import { SERVICE_SCOPE_TITLE, inquiryBelongsToScope, type InboxScope } from "@/lib/inbox-scope";
import { listCategoryLabelsForScope, listGames, type CategoryLabelMaps, type GameRow } from "@/lib/categories";
import { getAccountHistory, type AccountHistoryEntry } from "@/lib/account-history";
import { listNotes, listNotesByInquiryIds } from "@/lib/notes";
import { listEvents } from "@/lib/events";
import { listTemplates, type TemplateRow } from "@/lib/templates";
import { listMessages, listMessagesByInquiryIds } from "@/lib/messages";
import type { AccountThread } from "@/lib/timeline";
import type { InboxSelection } from "@/components/inbox/InboxShell";

export interface InboxPageData {
  scope: InboxScope;
  title: string;
  /** 게임 스코프에서만. 서비스 문의에는 게임이 없다. */
  game: GameRow | null;
  query: InquiryListQuery;
  labels: CategoryLabelMaps;
  counts: InquiryFacetCounts | null;
  listPage: InquiryPage;
  selected: InboxSelection | null;
}

/**
 * 인박스 한 화면의 데이터. 게임 페이지와 서비스 페이지가 스코프만 다르게 이 함수를 부른다.
 * 스코프의 게임이 없거나, 고른 문의가 없거나 스코프 밖이면 null — 페이지가 notFound()로 바꾼다.
 */
export async function loadInboxPage(
  supabase: SupabaseClient,
  scope: InboxScope,
  inquiryId: string | null,
  searchParams: Record<string, string | string[] | undefined>
): Promise<InboxPageData | null> {
  const query = parseInquiryListQuery(searchParams);

  const [games, labels, counts, listPage] = await Promise.all([
    scope.kind === "game" ? listGames(supabase) : Promise.resolve([] as GameRow[]),
    listCategoryLabelsForScope(supabase, scope),
    getInquiryFacetCounts(supabase, scope),
    queryInquiries(supabase, scope, query),
  ]);

  let game: GameRow | null = null;
  if (scope.kind === "game") {
    game = games.find((entry) => entry.id === scope.gameId) ?? null;
    if (!game) return null;
  }
  const title = game ? game.name : SERVICE_SCOPE_TITLE;

  let selected: InboxSelection | null = null;
  if (inquiryId) {
    const inquiry = await getInquiryById(supabase, inquiryId);
    if (!inquiry || !inquiryBelongsToScope(scope, inquiry.gameId)) {
      return null;
    }

    // 계정 이력·같은 계정 이어보기·답변 템플릿은 게임에 딸린 것이라 서비스 문의에는 없다.
    const gameId = scope.kind === "game" ? scope.gameId : null;
    const [attachments, history, notes, events, templates, messages, siblingIds] = await Promise.all([
      listAttachmentSignedUrls(supabase, inquiry.id),
      gameId ? getAccountHistory(supabase, gameId, inquiry.gameAccount, inquiry.id) : Promise.resolve<AccountHistoryEntry[] | null>(null),
      listNotes(supabase, inquiry.id),
      listEvents(supabase, inquiry.id),
      gameId ? listTemplates(supabase, gameId) : Promise.resolve([] as TemplateRow[]),
      listMessages(supabase, inquiry.id),
      listInquiryIds(supabase, scope, query),
    ]);

    // 같은 계정의 다른 문의도 대화 열에 이어 보여준다. 이력 id로 메시지·메모·첨부를 한 번에 가져온다.
    const historyEntries = history ?? [];
    const historyIds = historyEntries.map((entry) => entry.id);
    const [pastMessages, pastNotes, pastAttachments] = await Promise.all([
      listMessagesByInquiryIds(supabase, historyIds),
      listNotesByInquiryIds(supabase, historyIds),
      Promise.all(historyEntries.map((entry) => listAttachmentSignedUrls(supabase, entry.id))),
    ]);
    const pastThreads: AccountThread[] = historyEntries.map((entry, index) => ({
      inquiry: { ...entry, gameAccount: inquiry.gameAccount },
      attachments: pastAttachments[index],
      messages: pastMessages[entry.id] ?? [],
      notes: pastNotes[entry.id] ?? [],
    }));

    selected = { inquiry, attachments, history, notes, events, templates, messages, siblingIds, pastThreads };
  }

  return { scope, title, game, query, labels, counts, listPage, selected };
}
```

`lib/templates.ts`가 `TemplateRow`를 export하는지 확인한다(`grep -n "export interface TemplateRow" lib/templates.ts`). 없으면 `Awaited<ReturnType<typeof listTemplates>>`를 쓴다. 빈 `historyIds`로 `listMessagesByInquiryIds`/`listNotesByInquiryIds`를 부르는 것은 기존 페이지도 이력이 없을 때 하던 일이라 그대로 둔다.

- [ ] **Step 5: Update `InboxShell`**

`components/inbox/InboxShell.tsx`:

```ts
import type { InboxScope } from "@/lib/inbox-scope";
```
`InboxSelection.history`를 `AccountHistoryEntry[] | null;`로 바꾸고 주석 `/** 계정 이력. 서비스 문의는 게임 계정이 없어 null. */`.

컴포넌트:
```tsx
/** 4단 배치. 게임 레일은 관리자 layout이 그리므로 여기에는 보기·목록·대화·상세만 있다. */
export default function InboxShell({
  scope,
  title,
  game,
  query,
  labels,
  counts,
  listPage,
  selected,
}: {
  scope: InboxScope;
  title: string;
  game: GameRow | null;
  query: InquiryListQuery;
  labels: CategoryLabelMaps;
  counts: InquiryFacetCounts | null;
  listPage: InquiryPage;
  selected: InboxSelection | null;
}) {
  const selectedId = selected?.inquiry.id ?? null;

  return (
    <div className="flex h-screen min-w-[1180px] flex-1">
      <InboxNav scope={scope} title={title} game={game} query={query} labels={labels} counts={counts} selectedId={selectedId} />
      <InboxList scope={scope} page={listPage} query={query} labels={labels} selectedId={selectedId} viewLabel={describeView(query)} />
```
`InboxConversation`의 `scope={scope}`는 Task 2에서 이미 바뀌었다. Task 2에서 넣은 `gameScope` import와 `const scope = gameScope(game.id);`는 지운다.

- [ ] **Step 6: Narrow `gameId` in the detail panel**

`components/inbox/InboxDetailPanel.tsx`의 이력 분기: `AccountHistoryPanel`은 `gameId: string`을 받으므로 null을 걸러 넘긴다. 서비스 문의는 `history`가 null이라 이 분기에 오지 않는다.

```tsx
        ) : (
          <div className="px-4 py-3.5">
            {inquiry.gameId !== null && (
              <AccountHistoryPanel history={history ?? []} gameAccount={inquiry.gameAccount} currentTypeKey={inquiry.typeKey} gameId={inquiry.gameId} frameless />
            )}
          </div>
        )}
```

- [ ] **Step 7: Rewrite the game page and add the service page**

`app/(admin)/games/[gameId]/inquiries/[[...inquiryId]]/page.tsx` 전체:

```tsx
import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { gameScope } from "@/lib/inbox-scope";
import { loadInboxPage } from "@/lib/inbox-page";
import InboxShell from "@/components/inbox/InboxShell";

export const dynamic = "force-dynamic";

/**
 * 게임 하나의 인박스. /games/{g}/inquiries 는 목록만, /games/{g}/inquiries/{id} 는
 * 대화·상세까지. 필터는 같은 URL의 쿼리로 남으므로 문의를 골라도 목록 상태가 유지된다.
 */
export default async function InboxPage({
  params,
  searchParams,
}: {
  params: { gameId: string; inquiryId?: string[] };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  if (params.inquiryId && params.inquiryId.length > 1) {
    notFound();
  }
  const data = await loadInboxPage(getSupabaseServerClient(), gameScope(params.gameId), params.inquiryId?.[0] ?? null, searchParams);
  if (!data) {
    notFound();
  }
  return <InboxShell {...data} />;
}
```

`app/(admin)/service/inquiries/[[...inquiryId]]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { SERVICE_SCOPE } from "@/lib/inbox-scope";
import { loadInboxPage } from "@/lib/inbox-page";
import InboxShell from "@/components/inbox/InboxShell";

export const dynamic = "force-dynamic";

/**
 * 서비스 문의(제휴·기타) 인박스. 게임 없이 접수된 문의(inquiries.game_id is null)를
 * 게임 인박스와 같은 4단 화면으로 보여준다. 계정 이력·답변 템플릿은 게임에 딸린 것이라 없다.
 */
export default async function ServiceInboxPage({
  params,
  searchParams,
}: {
  params: { inquiryId?: string[] };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  if (params.inquiryId && params.inquiryId.length > 1) {
    notFound();
  }
  const data = await loadInboxPage(getSupabaseServerClient(), SERVICE_SCOPE, params.inquiryId?.[0] ?? null, searchParams);
  if (!data) {
    notFound();
  }
  return <InboxShell {...data} />;
}
```

`app/(admin)/inquiries/[id]/page.tsx`는 Task 2에서 이미 `scopeForGameId(inquiry.gameId)`를 쓰므로 nullable이 되어도 그대로 컴파일된다.

- [ ] **Step 8: Run tests, type check, and build**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: 전부 PASS, tsc 오류 없음, build 성공(`/service/inquiries/[[...inquiryId]]` 라우트가 출력에 보인다).

- [ ] **Step 9: Commit**

```bash
git add lib/inquiries.ts lib/inbox-page.ts tests/lib/inbox-page.test.ts components/inbox/InboxShell.tsx components/inbox/InboxDetailPanel.tsx "app/(admin)/games/[gameId]/inquiries/[[...inquiryId]]/page.tsx" "app/(admin)/service/inquiries/[[...inquiryId]]/page.tsx"
git commit -m "feat: service inquiry inbox at /service/inquiries sharing the game inbox loader"
```

---

### Task 12: 문서 갱신과 마무리 검증

**Files:**
- Modify: `CLAUDE.md` (핵심 기능 2번)
- Modify: `docs/PRD.md:20, 435`
- Modify: `docs/superpowers/specs/2026-09-01-admin-panel-design.md:228` (끝에 한 줄)

- [ ] **Step 1: CLAUDE.md**

핵심 기능 2번 문단 끝(`예전 `/inquiries/{id}` 링크는 새 URL로 리다이렉트된다.` 뒤)에 추가:

```
게임 레일 맨 위의 "서비스 문의" 타일은 게임 없이 접수된 제휴·기타 문의(`game_id is null`)를 같은 화면으로 `/service/inquiries[/{inquiryId}]`에서 보여준다(`lib/inbox-scope.ts`의 스코프로 분기). 유형 필터는 전역 `service_groups`/`service_types`(마이그레이션 0010)에서 오고, 건수 RPC는 0009부터 null 인자를 서비스 문의로 센다. 서비스 문의에는 계정 이력·같은 계정 이어보기·답변 템플릿이 없다.
```

핵심 기능 6번(Slack 알림) 문단에 한 문장 추가: `서비스 문의는 게임명 자리에 "서비스 문의"가 들어가고 링크는 /service/inquiries/{id}다.`

- [ ] **Step 2: PRD**

20행 표에 행 추가:
```
| `docs/superpowers/specs/2026-09-04-service-inbox-design.md` | 서비스 문의(제휴·기타) 인박스 — 인박스 스코프, `/service/inquiries`, 마이그레이션 0009·0010 |
```
435행 U1을 바꾼다:
```
| U1 | ~~**서비스(게임 무관) 문의 관리 UI**~~ | **2026-09-04 완료.** 게임 레일의 "서비스 문의" 타일 → `/service/inquiries`. 스펙은 `docs/superpowers/specs/2026-09-04-service-inbox-design.md`. 남은 것: `service_groups`/`service_types` 편집 UI(지금은 Supabase에서 직접), 서비스 문의용 답변 템플릿(의도적으로 제외). |
```

- [ ] **Step 3: 2026-09-01 spec**

파일 끝에 추가:
```

**2026-09-04:** 이 절의 관리자 UI는 `docs/superpowers/specs/2026-09-04-service-inbox-design.md`대로 구현됐다. 상단 네비 대신 게임 레일 타일, 목록 페이지 대신 기존 인박스 재사용이다.
```

- [ ] **Step 4: Full verification**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: 전부 통과.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/PRD.md docs/superpowers/specs/2026-09-01-admin-panel-design.md
git commit -m "docs: record the service inquiry inbox in CLAUDE.md, PRD, and the original spec"
```

- [ ] **Step 6: 배포 메모 (코드 아님)**

배포 순서는 스펙대로: Supabase SQL Editor에서 `0009_service_inquiry_facets.sql` 적용 → 코드 배포. 0010은 이미 적용된 스키마의 사본이라 돌려도 무해하다. 0009를 먼저 적용하지 않으면 서비스 문의함의 건수만 0으로 나오고 목록은 정상이다.
