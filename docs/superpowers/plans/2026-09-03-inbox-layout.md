# 인박스형 4단 레이아웃 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 게임별 문의 목록 페이지와 문의 상세 페이지를 헬프데스크 인박스처럼 한 화면(게임 레일 · 문의함 보기 · 목록 · 대화+답변 · 상세 패널)으로 합친다.

**Architecture:** `app/(admin)/games/[gameId]/inquiries/[[...inquiryId]]/page.tsx` 한 페이지가 4단 전체를 서버 렌더한다. 필터·정렬·검색·페이지는 URL 쿼리가 원본이고, 문의를 골라도 같은 쿼리가 URL에 남는다. 새 컴포넌트는 `components/inbox/`에 두고, 기존 `components/inquiries/`의 쓰기 컴포넌트(StatusSelect, ReplyForm 등)는 그대로 재사용한다. 쓰기 동작은 지금처럼 API 호출 후 `router.refresh()`.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind CSS 3, Supabase (service-role 클라이언트, RPC 1개 추가), Vitest + React Testing Library + user-event.

**Spec:** `docs/superpowers/specs/2026-09-03-inbox-layout-design.md`

## Global Constraints

- 관리자 UI는 한국어 전용. 문구는 스펙과 이 계획에 적힌 것을 그대로 쓴다.
- 카테고리/유형은 DB(`inquiry_groups`, `inquiry_types`)에서 온다. 하드코딩 금지.
- 부가 작업(집계 RPC, 이벤트 적재 등) 실패가 핵심 데이터 표시·저장을 막지 않는다.
- Supabase·Gmail 자격 증명은 코드/문서에 평문으로 넣지 않는다.
- 디자인 토큰은 `tailwind.config.ts`의 `ground #F4F4F6 / panel #FFFFFF / ink #1A1B1F / muted #6E7076 / line #E5E6EA / accent #EA581F`만 쓴다. 상태 배지는 `components/ui/StatusBadge`.
- 4단 최소 폭 `min-w-[1180px]`. 열 폭: 문의함 보기 224px, 목록 340px, 상세 300px, 대화는 나머지.
- 3일 이상 미처리(stale) = `status <> 'resolved'` AND `created_at < now() - 72시간`.
- 테스트 명령: `npm test` (vitest run). 특정 파일: `npx vitest run tests/lib/foo.test.ts`. 타입 검사: `npx tsc --noEmit`.
- 컴포넌트 테스트 파일 첫 줄은 `// @vitest-environment jsdom`.
- 커밋 메시지 끝에 다음 두 줄을 붙인다.
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01M5jqLuCMqTMFeYsSa8txRe
  ```

## 파일 구조

새로 만드는 것

| 파일 | 책임 |
|---|---|
| `supabase/migrations/0008_inquiry_facet_counts.sql` | 보기 건수 집계 SQL 함수 |
| `lib/timeline.ts` | 문의 본문·메시지·메모를 시간순 항목으로 합치는 순수 함수 |
| `components/inbox/InboxShell.tsx` | 4단 배치 (server) |
| `components/inbox/InboxNav.tsx` | 문의함 보기 열 (server) |
| `components/inbox/InboxSearch.tsx` | 검색 입력 (client, 디바운스) |
| `components/inbox/InboxList.tsx` | 목록 열 (client: 선택·일괄 변경·정렬·페이지) |
| `components/inbox/InboxConversation.tsx` | 대화 열: 헤더 + 타임라인 + 작성란 (server) |
| `components/inbox/InboxPrevNext.tsx` | 이전/다음 (server) |
| `components/inbox/InboxTimeline.tsx` | 타임라인 렌더 (server) |
| `components/inbox/ReplyComposer.tsx` | 답변/내부 메모 탭 (client) |
| `components/inbox/NoteForm.tsx` | 내부 메모 폼 (client) |
| `components/inbox/InboxDetailPanel.tsx` | 상세/계정 이력 탭 (client) |
| `components/inbox/InboxEmptyState.tsx` | 문의 미선택 상태 (server) |
| `app/(admin)/games/[gameId]/inquiries/[[...inquiryId]]/page.tsx` | 인박스 페이지 |

수정하는 것

| 파일 | 변경 |
|---|---|
| `lib/inquiry-filters.ts` | `priority`, `stale` 쿼리, `inquiryHref`/`inboxHref`/`legacyInquiryRedirectHref`, `inquiryDetailHref` 제거 |
| `lib/inquiries.ts` | `applyFilters`에 priority/stale, `getInquiryFacetCounts` |
| `lib/categories.ts` | `CategoryLabelMaps.typeOrder` |
| `lib/format.ts` | `inquiryMetaRows` (InquiryMetaCard에서 옮김) |
| `components/inquiries/AccountHistoryPanel.tsx` | `gameId`, `frameless` props |
| `app/(admin)/layout.tsx` | main 여백 제거, 전체 높이 |
| `app/(admin)/games/page.tsx`, `app/(admin)/games/[gameId]/templates/page.tsx` | 자체 여백 래퍼 |
| `app/(admin)/inquiries/[id]/page.tsx` | 새 URL로 리다이렉트만 |
| `app/api/notify/inquiry/route.ts` | Slack 링크를 새 URL로 |
| `CLAUDE.md` | 핵심 기능 2·5 설명 갱신 |

삭제하는 것 (Task 15)

`app/(admin)/games/[gameId]/inquiries/page.tsx`(Task 13에서), `components/inquiries/{InquiryMailbox,InquiryNav,InquiryDetail,InquiryThread,InquiryNotes,InquiryHeader,InquiryMetaCard,InquiryEventLog}.tsx`와 대응 테스트 8개.

---

### Task 1: 쿼리 파라미터 `priority`/`stale`와 링크 헬퍼

**Files:**
- Modify: `lib/inquiry-filters.ts`
- Test: `tests/lib/inquiry-filters.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface InquiryListQuery { group; type; status; priority: InquiryPriority | null; stale: boolean; q; sort; page }
  DEFAULT_QUERY  // priority: null, stale: false 추가
  inquiryHref(gameId: string, inquiryId: string, query: InquiryListQuery): string      // /games/{g}/inquiries/{id}?...
  inboxHref(gameId: string, selectedId: string | null, query: InquiryListQuery): string // selectedId 있으면 inquiryHref, 없으면 inquiryListHref
  legacyInquiryRedirectHref(gameId: string, inquiryId: string, listParam: string | null | undefined): string
  ```
- `inquiryDetailHref`는 이 Task에서는 남겨 둔다 (InquiryMailbox/InquiryNav가 아직 쓴다). Task 15에서 지운다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/lib/inquiry-filters.test.ts`에 다음을 추가한다. 기존 `import`에 `inquiryHref, inboxHref, legacyInquiryRedirectHref`를 더한다.

```ts
describe("priority and stale", () => {
  it("parses a valid priority and drops an invalid one", () => {
    expect(parseInquiryListQuery("priority=urgent").priority).toBe("urgent");
    expect(parseInquiryListQuery("priority=whatever").priority).toBeNull();
  });

  it("parses stale=1 only", () => {
    expect(parseInquiryListQuery("stale=1").stale).toBe(true);
    expect(parseInquiryListQuery("stale=true").stale).toBe(false);
    expect(parseInquiryListQuery("").stale).toBe(false);
  });

  it("serializes priority and stale and round-trips", () => {
    const query = { ...DEFAULT_QUERY, priority: "high" as const, stale: true };
    expect(toInquiryListSearch(query)).toBe("priority=high&stale=1");
    expect(parseInquiryListQuery(toInquiryListSearch(query))).toEqual(query);
  });

  it("keeps the existing serialization order for the old fields", () => {
    const query = { ...DEFAULT_QUERY, status: "resolved" as const, sort: "priority" as const, page: 2, q: "a b" };
    expect(toInquiryListSearch(query)).toBe("status=resolved&q=a+b&sort=priority&page=2");
  });
});

describe("inbox hrefs", () => {
  it("builds the inquiry href with the list query on the same URL", () => {
    expect(inquiryHref("g1", "i1", DEFAULT_QUERY)).toBe("/games/g1/inquiries/i1");
    expect(inquiryHref("g1", "i1", { ...DEFAULT_QUERY, status: "new", page: 2 })).toBe(
      "/games/g1/inquiries/i1?status=new&page=2"
    );
  });

  it("inboxHref keeps the selected inquiry when there is one", () => {
    expect(inboxHref("g1", null, { ...DEFAULT_QUERY, q: "x" })).toBe("/games/g1/inquiries?q=x");
    expect(inboxHref("g1", "i1", { ...DEFAULT_QUERY, q: "x" })).toBe("/games/g1/inquiries/i1?q=x");
  });

  it("legacy redirect decodes the old list param into the new URL", () => {
    expect(legacyInquiryRedirectHref("g1", "i1", undefined)).toBe("/games/g1/inquiries/i1");
    expect(legacyInquiryRedirectHref("g1", "i1", "status=new&sort=oldest")).toBe(
      "/games/g1/inquiries/i1?status=new&sort=oldest"
    );
    expect(legacyInquiryRedirectHref("g1", "i1", "status=bogus")).toBe("/games/g1/inquiries/i1");
  });
});
```

또한 기존 `reads every field from a query string` 테스트의 기대 객체에 `priority: null, stale: false`를 추가한다 (`toEqual`이므로 빠지면 실패한다).

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/lib/inquiry-filters.test.ts`
Expected: FAIL — `inquiryHref is not a function`, `priority` 관련 toEqual 불일치.

- [ ] **Step 3: 구현**

`lib/inquiry-filters.ts`:

```ts
import type { InquiryPriority, InquiryStatus } from "@/lib/inquiries";

export type InquirySort = "newest" | "oldest" | "priority";

export interface InquiryListQuery {
  group: string | null;
  type: string | null;
  status: InquiryStatus | null;
  priority: InquiryPriority | null;
  /** 완료가 아니면서 접수 후 72시간 지난 건만. */
  stale: boolean;
  q: string;
  sort: InquirySort;
  page: number;
}

export const PAGE_SIZE = 50;

export const SORT_OPTIONS: Array<{ value: InquirySort; label: string }> = [
  { value: "newest", label: "최신순" },
  { value: "oldest", label: "오래된순" },
  { value: "priority", label: "우선순위순" },
];

const STATUSES: InquiryStatus[] = ["new", "in_progress", "resolved"];
const PRIORITIES: InquiryPriority[] = ["urgent", "high", "normal", "low"];
const SORTS: InquirySort[] = ["newest", "oldest", "priority"];

export const DEFAULT_QUERY: InquiryListQuery = {
  group: null,
  type: null,
  status: null,
  priority: null,
  stale: false,
  q: "",
  sort: "newest",
  page: 1,
};
```

`parseInquiryListQuery`의 return 객체에 추가:

```ts
    priority: PRIORITIES.includes(priority as InquiryPriority) ? (priority as InquiryPriority) : null,
    stale: readParam(params, "stale") === "1",
```

(`const priority = readParam(params, "priority");`를 위에 선언.)

`toInquiryListSearch`의 `status` 다음, `q` 앞에:

```ts
  if (query.priority) params.set("priority", query.priority);
  if (query.stale) params.set("stale", "1");
```

파일 끝에 헬퍼 추가 (기존 `inquiryListHref`, `inquiryDetailHref`는 그대로 둔다):

```ts
/** 인박스에서 문의 하나를 연 URL. 목록 상태는 같은 URL의 쿼리로 남는다. */
export function inquiryHref(gameId: string, inquiryId: string, query: InquiryListQuery): string {
  const search = toInquiryListSearch(query);
  const base = `/games/${gameId}/inquiries/${inquiryId}`;
  return search ? `${base}?${search}` : base;
}

/** 선택된 문의가 있으면 유지한 채, 없으면 목록만 가리키는 URL. 필터·정렬·페이지 이동이 쓴다. */
export function inboxHref(gameId: string, selectedId: string | null, query: InquiryListQuery): string {
  return selectedId ? inquiryHref(gameId, selectedId, query) : inquiryListHref(gameId, query);
}

/** 예전 /inquiries/{id}?list=... 링크를 새 URL로 옮긴다. Slack에 이미 나간 링크 호환용. */
export function legacyInquiryRedirectHref(
  gameId: string,
  inquiryId: string,
  listParam: string | null | undefined
): string {
  return inquiryHref(gameId, inquiryId, parseInquiryListQuery(listParam ?? ""));
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/lib/inquiry-filters.test.ts`
Expected: PASS

- [ ] **Step 5: 전체 테스트와 타입 확인**

Run: `npm test && npx tsc --noEmit`
Expected: PASS. `tsc`가 `InquiryListQuery` 리터럴에 `priority`/`stale`가 없다고 하는 곳(테스트 포함)이 있으면 `...DEFAULT_QUERY` 스프레드로 고친다.

- [ ] **Step 6: 커밋**

```bash
git add lib/inquiry-filters.ts tests/lib/inquiry-filters.test.ts
git commit -m "feat: add priority/stale list filters and inbox hrefs"
```

---

### Task 2: DB 쿼리에 priority/stale 조건

**Files:**
- Modify: `lib/inquiries.ts` (`FilterBuilder`, `applyFilters`, `queryInquiries`, `listInquiryIds`)
- Test: `tests/lib/inquiries.test.ts`

**Interfaces:**
- Consumes: `InquiryListQuery.priority`, `.stale` (Task 1)
- Produces:
  ```ts
  queryInquiries(supabase, gameId, query, options?: { now?: Date }): Promise<InquiryPage>
  listInquiryIds(supabase, gameId, query, options?: { limit?: number; now?: Date }): Promise<string[]>
  STALE_AFTER_MS = 72 * 60 * 60 * 1000
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/lib/inquiries.test.ts`의 `mockBuilder`에서 메서드 목록을 `["eq", "neq", "lt", "or", "order", "range", "limit", "in"]`로 바꾼다. `describe("queryInquiries")` 안에 추가:

```ts
  it("filters by priority", async () => {
    const { from, calls } = mockBuilder({ data: [], count: 0 });
    await queryInquiries({ from } as never, "game-1", { ...DEFAULT_QUERY, priority: "urgent" });
    expect(calls.eq).toEqual([
      ["game_id", "game-1"],
      ["priority", "urgent"],
    ]);
  });

  it("stale means unresolved and older than 72 hours from the injected now", async () => {
    const { from, calls } = mockBuilder({ data: [], count: 0 });
    const now = new Date("2026-09-04T12:00:00.000Z");

    await queryInquiries({ from } as never, "game-1", { ...DEFAULT_QUERY, stale: true }, { now });

    expect(calls.neq).toEqual([["status", "resolved"]]);
    expect(calls.lt).toEqual([["created_at", "2026-09-01T12:00:00.000Z"]]);
  });

  it("does not add stale conditions by default", async () => {
    const { from, calls } = mockBuilder({ data: [], count: 0 });
    await queryInquiries({ from } as never, "game-1", DEFAULT_QUERY);
    expect(calls.neq).toEqual([]);
    expect(calls.lt).toEqual([]);
  });
```

`describe("listInquiryIds")`에 추가:

```ts
  it("accepts a custom limit and applies stale with the injected now", async () => {
    const { from, calls } = mockBuilder({ data: [] });
    await listInquiryIds({ from } as never, "game-1", { ...DEFAULT_QUERY, stale: true }, {
      limit: 10,
      now: new Date("2026-09-04T12:00:00.000Z"),
    });
    expect(calls.limit).toEqual([[10]]);
    expect(calls.lt).toEqual([["created_at", "2026-09-01T12:00:00.000Z"]]);
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/lib/inquiries.test.ts`
Expected: FAIL — `calls.neq` 빈 배열, limit 10이 아니라 1000.

- [ ] **Step 3: 구현**

`lib/inquiries.ts`:

```ts
export const STALE_AFTER_MS = 72 * 60 * 60 * 1000;

interface FilterBuilder {
  eq(column: string, value: string): FilterBuilder;
  neq(column: string, value: string): FilterBuilder;
  lt(column: string, value: string): FilterBuilder;
  or(filters: string): FilterBuilder;
  order(column: string, options: { ascending: boolean }): FilterBuilder;
  range(from: number, to: number): FilterBuilder;
  limit(count: number): FilterBuilder;
}

function applyFilters<T extends FilterBuilder>(builder: T, gameId: string, query: InquiryListQuery, now: Date): T {
  let next = builder.eq("game_id", gameId) as T;
  if (query.group) next = next.eq("group_key", query.group) as T;
  if (query.type) next = next.eq("type_key", query.type) as T;
  if (query.status) next = next.eq("status", query.status) as T;
  if (query.priority) next = next.eq("priority", query.priority) as T;
  if (query.stale) {
    // "3일 이상 미처리": 완료가 아니면서 접수 후 72시간이 지난 건.
    const cutoff = new Date(now.getTime() - STALE_AFTER_MS).toISOString();
    next = next.neq("status", "resolved").lt("created_at", cutoff) as T;
  }

  const q = sanitizeSearch(query.q);
  if (q) {
    const pattern = `%${q}%`;
    next = next.or(
      `title.ilike.${pattern},inquiry_no.ilike.${pattern},game_account.ilike.${pattern},content.ilike.${pattern}`
    ) as T;
  }
  return next;
}
```

`queryInquiries` 시그니처와 호출:

```ts
export async function queryInquiries(
  supabase: SupabaseClient,
  gameId: string,
  query: InquiryListQuery,
  options: { now?: Date } = {}
): Promise<InquiryPage> {
  const now = options.now ?? new Date();
  const from = (query.page - 1) * PAGE_SIZE;
  const builder = applyOrder(
    applyFilters(supabase.from("inquiries").select("*", { count: "exact" }) as unknown as FilterBuilder, gameId, query, now),
    query
  ).range(from, from + PAGE_SIZE - 1);
  // 나머지는 그대로
```

`listInquiryIds`:

```ts
export async function listInquiryIds(
  supabase: SupabaseClient,
  gameId: string,
  query: InquiryListQuery,
  options: { limit?: number; now?: Date } = {}
): Promise<string[]> {
  const limit = options.limit ?? 1000;
  const now = options.now ?? new Date();
  const builder = applyOrder(
    applyFilters(supabase.from("inquiries").select("id") as unknown as FilterBuilder, gameId, query, now),
    query
  ).limit(limit);
  // 나머지는 그대로
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/lib/inquiries.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/inquiries.ts tests/lib/inquiries.test.ts
git commit -m "feat: filter inquiries by priority and staleness"
```

---

### Task 3: 보기 건수 집계 RPC

**Files:**
- Create: `supabase/migrations/0008_inquiry_facet_counts.sql`
- Modify: `lib/inquiries.ts`
- Test: `tests/lib/inquiries.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface InquiryFacetCounts {
    total: number;
    status: Record<InquiryStatus, number>;
    type: Record<string, number>;
    priority: Record<InquiryPriority, number>;
    stale: number;
  }
  getInquiryFacetCounts(supabase, gameId): Promise<InquiryFacetCounts | null>
  ```

- [ ] **Step 1: 마이그레이션 작성**

`supabase/migrations/0008_inquiry_facet_counts.sql`:

```sql
-- 문의함 보기 열의 건수(상태별·유형별·우선순위별·3일 이상 미처리·전체)를
-- 한 번의 RPC로 가져온다. 행을 다 읽어 앱에서 세면 PostgREST 기본 1,000행
-- 제한에 걸리므로 DB에서 센다. 72시간 기준은 lib/inquiries.ts STALE_AFTER_MS와 같다.

create or replace function inquiry_facet_counts(p_game_id uuid)
returns table (facet text, key text, count bigint)
language sql
stable
as $$
  select 'status'::text, status::text, count(*) from inquiries where game_id = p_game_id group by status
  union all
  select 'type', type_key, count(*) from inquiries where game_id = p_game_id group by type_key
  union all
  select 'priority', coalesce(priority, 'normal'), count(*) from inquiries where game_id = p_game_id group by 2
  union all
  select 'stale', '1', count(*) from inquiries
    where game_id = p_game_id and status <> 'resolved' and created_at < now() - interval '72 hours'
  union all
  select 'total', 'all', count(*) from inquiries where game_id = p_game_id
$$;

-- 관리자 앱은 service-role 클라이언트로 호출한다. 접수 폼(anon)에는 열지 않는다.
revoke execute on function inquiry_facet_counts(uuid) from public, anon, authenticated;
grant execute on function inquiry_facet_counts(uuid) to service_role;
```

- [ ] **Step 2: 실패하는 테스트 작성**

`tests/lib/inquiries.test.ts` import에 `getInquiryFacetCounts`를 더하고 추가:

```ts
describe("getInquiryFacetCounts", () => {
  it("calls the RPC and folds rows into a counts object", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { facet: "status", key: "new", count: 4 },
        { facet: "status", key: "in_progress", count: 7 },
        { facet: "type", key: "bug_report", count: 5 },
        { facet: "type", key: "payment_refund", count: 8 },
        { facet: "priority", key: "urgent", count: 1 },
        { facet: "priority", key: "high", count: 3 },
        { facet: "stale", key: "1", count: 2 },
        { facet: "total", key: "all", count: 23 },
      ],
      error: null,
    });

    const counts = await getInquiryFacetCounts({ rpc } as never, "game-1");

    expect(rpc).toHaveBeenCalledWith("inquiry_facet_counts", { p_game_id: "game-1" });
    expect(counts).toEqual({
      total: 23,
      status: { new: 4, in_progress: 7, resolved: 0 },
      type: { bug_report: 5, payment_refund: 8 },
      priority: { urgent: 1, high: 3, normal: 0, low: 0 },
      stale: 2,
    });
  });

  it("ignores unknown facets and keys and coerces bigint strings", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { facet: "status", key: "weird", count: "9" },
        { facet: "mystery", key: "x", count: 1 },
        { facet: "total", key: "all", count: "12" },
      ],
      error: null,
    });
    const counts = await getInquiryFacetCounts({ rpc } as never, "game-1");
    expect(counts?.total).toBe(12);
    expect(counts?.status).toEqual({ new: 0, in_progress: 0, resolved: 0 });
  });

  it("returns null when the RPC fails", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(getInquiryFacetCounts({ rpc } as never, "game-1")).resolves.toBeNull();
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run tests/lib/inquiries.test.ts`
Expected: FAIL — `getInquiryFacetCounts is not a function`

- [ ] **Step 4: 구현**

`lib/inquiries.ts` 끝에 추가:

```ts
export interface InquiryFacetCounts {
  total: number;
  status: Record<InquiryStatus, number>;
  type: Record<string, number>;
  priority: Record<InquiryPriority, number>;
  stale: number;
}

const STATUS_KEYS: InquiryStatus[] = ["new", "in_progress", "resolved"];
const PRIORITY_KEYS: InquiryPriority[] = ["urgent", "high", "normal", "low"];

/**
 * 문의함 보기 열의 건수. 마이그레이션 0008의 inquiry_facet_counts RPC 한 번으로
 * 가져온다. 실패하면 null — 건수는 부가 정보라 목록 표시를 막지 않는다.
 */
export async function getInquiryFacetCounts(
  supabase: SupabaseClient,
  gameId: string
): Promise<InquiryFacetCounts | null> {
  const { data, error } = await supabase.rpc("inquiry_facet_counts", { p_game_id: gameId });
  if (error || !data) {
    return null;
  }

  const counts: InquiryFacetCounts = {
    total: 0,
    status: { new: 0, in_progress: 0, resolved: 0 },
    type: {},
    priority: { urgent: 0, high: 0, normal: 0, low: 0 },
    stale: 0,
  };

  for (const row of data as Array<{ facet: string; key: string; count: number | string }>) {
    const count = Number(row.count) || 0;
    switch (row.facet) {
      case "status":
        if (STATUS_KEYS.includes(row.key as InquiryStatus)) counts.status[row.key as InquiryStatus] = count;
        break;
      case "type":
        counts.type[row.key] = count;
        break;
      case "priority":
        if (PRIORITY_KEYS.includes(row.key as InquiryPriority)) counts.priority[row.key as InquiryPriority] = count;
        break;
      case "stale":
        counts.stale = count;
        break;
      case "total":
        counts.total = count;
        break;
    }
  }
  return counts;
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/lib/inquiries.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add supabase/migrations/0008_inquiry_facet_counts.sql lib/inquiries.ts tests/lib/inquiries.test.ts
git commit -m "feat: aggregate inbox view counts with one RPC"
```

---

### Task 4: 유형 정렬 순서 (`typeOrder`)

**Files:**
- Modify: `lib/categories.ts` (`CategoryLabelMaps`, `listCategoryLabels`)
- Modify: `app/api/notify/inquiry/route.ts` (fallback 리터럴), `tests/api/notify-inquiry.test.ts`
- Test: `tests/lib/categories.test.ts`

**Interfaces:**
- Produces: `CategoryLabelMaps { groupLabels; typeLabels; typeOrder: string[] }` — 그룹 `sort_order` → 유형 `sort_order` 순의 유형 key 목록.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/lib/categories.test.ts` import에 `listCategoryLabels`를 더하고 추가:

```ts
describe("listCategoryLabels", () => {
  function chain(result: { data: unknown; error: null }) {
    const builder: Record<string, unknown> = {};
    for (const name of ["eq", "in", "order"]) {
      builder[name] = vi.fn(() => builder);
    }
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return builder;
  }

  it("returns labels plus type keys ordered by group then type sort_order", async () => {
    const groups = chain({
      data: [
        { id: "g-a", key: "game_usage", label_ko: "게임 이용 문의" },
        { id: "g-b", key: "business", label_ko: "사업 제휴 문의" },
      ],
      error: null,
    });
    const types = chain({
      data: [
        { key: "publishing", label_ko: "퍼블리싱", group_id: "g-b" },
        { key: "account_login", label_ko: "계정/로그인", group_id: "g-a" },
        { key: "bug_report", label_ko: "버그", group_id: "g-a" },
      ],
      error: null,
    });
    const from = vi.fn((table: string) => ({
      select: vi.fn(() => (table === "inquiry_groups" ? groups : types)),
    }));

    const labels = await listCategoryLabels({ from } as never, "game-1");

    expect(labels.groupLabels).toEqual({ game_usage: "게임 이용 문의", business: "사업 제휴 문의" });
    expect(labels.typeLabels.bug_report).toBe("버그");
    // DB가 sort_order로 정렬해 준 순서를 그룹 순서로 다시 묶는다.
    expect(labels.typeOrder).toEqual(["account_login", "bug_report", "publishing"]);
    expect(groups.order).toHaveBeenCalledWith("sort_order", { ascending: true });
    expect(types.order).toHaveBeenCalledWith("sort_order", { ascending: true });
  });

  it("returns empty maps and order when there are no groups", async () => {
    const groups = chain({ data: [], error: null });
    const from = vi.fn(() => ({ select: vi.fn(() => groups) }));
    await expect(listCategoryLabels({ from } as never, "game-1")).resolves.toEqual({
      groupLabels: {},
      typeLabels: {},
      typeOrder: [],
    });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/lib/categories.test.ts`
Expected: FAIL — `typeOrder` undefined, `order` 호출 없음.

- [ ] **Step 3: 구현**

`lib/categories.ts`:

```ts
export interface CategoryLabelMaps {
  groupLabels: Record<string, string>;
  typeLabels: Record<string, string>;
  /** 그룹 sort_order → 유형 sort_order 순의 유형 key. 문의함 보기 열이 이 순서로 나열한다. */
  typeOrder: string[];
}

export async function listCategoryLabels(supabase: SupabaseClient, gameId: string): Promise<CategoryLabelMaps> {
  const groupLabels: Record<string, string> = {};
  const typeLabels: Record<string, string> = {};
  const typeOrder: string[] = [];

  const { data: groups, error: groupsError } = await supabase
    .from("inquiry_groups")
    .select("id, key, label_ko")
    .eq("game_id", gameId)
    .order("sort_order", { ascending: true });

  if (groupsError || !groups || groups.length === 0) {
    return { groupLabels, typeLabels, typeOrder };
  }

  for (const group of groups) {
    groupLabels[group.key] = group.label_ko;
  }

  const { data: types, error: typesError } = await supabase
    .from("inquiry_types")
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
```

`app/api/notify/inquiry/route.ts`의 fallback을 `({ groupLabels: {}, typeLabels: {}, typeOrder: [] })`로. `tests/api/notify-inquiry.test.ts`에서 `listCategoryLabels` mock 반환값 두 곳(정상, fallback)에 `typeOrder: []`를 더한다.

- [ ] **Step 4: 통과 확인**

Run: `npm test && npx tsc --noEmit`
Expected: PASS. tsc가 `CategoryLabelMaps` 리터럴 부족을 지적하는 곳(예: `tests/components/InquiryMailbox.test.tsx`, `InquiryHeader.test.tsx`의 `labels`)이 있으면 `typeOrder: []`를 더한다.

- [ ] **Step 5: 커밋**

```bash
git add lib/categories.ts tests/lib/categories.test.ts app/api/notify/inquiry/route.ts tests/api/notify-inquiry.test.ts tests/components
git commit -m "feat: expose sorted type keys from listCategoryLabels"
```

---

### Task 5: 타임라인 조립 (`lib/timeline.ts`)

**Files:**
- Create: `lib/timeline.ts`
- Test: `tests/lib/timeline.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type TimelineEntry =
    | { kind: "inquiry"; id: string; at: string; author: string | null; body: string; attachments: AttachmentWithUrl[] }
    | { kind: "outbound"; id: string; at: string; author: string | null; body: string }
    | { kind: "inbound"; id: string; at: string; author: string | null; body: string }
    | { kind: "note"; id: string; at: string; author: string; body: string };
  buildTimeline(inquiry: InquiryRow, attachments: AttachmentWithUrl[], messages: MessageRow[], notes: NoteRow[]): TimelineEntry[]
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/lib/timeline.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildTimeline } from "@/lib/timeline";
import type { InquiryRow } from "@/lib/inquiries";
import type { MessageRow } from "@/lib/messages";
import type { NoteRow } from "@/lib/notes";

const inquiry: InquiryRow = {
  id: "inq-1",
  inquiryNo: "R-20260903-0007",
  gameId: "game-1",
  groupKey: "game_usage",
  typeKey: "payment_refund",
  gameAccount: "luna_park",
  companyName: null,
  replyEmail: "luna@example.com",
  title: "중복 결제",
  content: "두 번 결제됐어요",
  status: "in_progress",
  priority: "high",
  meta: {},
  draftReply: null,
  replyContent: null,
  repliedAt: null,
  gmailThreadId: "t1",
  createdAt: "2026-09-03T01:12:00.000Z",
};

const messages: MessageRow[] = [
  { id: "m-in", direction: "inbound", authorEmail: "luna@example.com", body: "감사합니다", gmailMessageId: "g2", rfcMessageId: null, sentAt: "2026-09-03T04:48:00.000Z" },
  { id: "m-out", direction: "outbound", authorEmail: "info@theplayplus.com", body: "환불 처리했습니다", gmailMessageId: "g1", rfcMessageId: "<a>", sentAt: "2026-09-03T02:05:00.000Z" },
];

const notes: NoteRow[] = [
  { id: "n-1", authorEmail: "hong@theplayplus.com", content: "중복 승인 확인", createdAt: "2026-09-03T01:40:00.000Z" },
];

describe("buildTimeline", () => {
  it("puts the inquiry body first and the rest in time order", () => {
    const attachments = [{ id: "a1", fileName: "명세서.png", signedUrl: "https://x/1" }];
    const entries = buildTimeline(inquiry, attachments, messages, notes);

    expect(entries.map((e) => e.kind)).toEqual(["inquiry", "note", "outbound", "inbound"]);
    expect(entries[0]).toEqual({
      kind: "inquiry",
      id: "inq-1",
      at: "2026-09-03T01:12:00.000Z",
      author: "luna_park",
      body: "두 번 결제됐어요",
      attachments,
    });
    expect(entries[1]).toMatchObject({ kind: "note", id: "n-1", author: "hong@theplayplus.com", body: "중복 승인 확인" });
    expect(entries[2]).toMatchObject({ kind: "outbound", id: "m-out", author: "info@theplayplus.com" });
    expect(entries[3]).toMatchObject({ kind: "inbound", id: "m-in", author: "luna@example.com" });
  });

  it("keeps the inquiry first even when a message predates createdAt", () => {
    const early: MessageRow = { ...messages[1], id: "m-early", sentAt: "2026-09-02T00:00:00.000Z" };
    const entries = buildTimeline(inquiry, [], [early], []);
    expect(entries.map((e) => e.id)).toEqual(["inq-1", "m-early"]);
  });

  it("is stable for equal timestamps (messages before notes as given)", () => {
    const same = "2026-09-03T02:05:00.000Z";
    const entries = buildTimeline(
      inquiry,
      [],
      [{ ...messages[1], sentAt: same }],
      [{ ...notes[0], createdAt: same }]
    );
    expect(entries.map((e) => e.id)).toEqual(["inq-1", "m-out", "n-1"]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/lib/timeline.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`lib/timeline.ts`:

```ts
import type { AttachmentWithUrl, InquiryRow } from "@/lib/inquiries";
import type { MessageRow } from "@/lib/messages";
import type { NoteRow } from "@/lib/notes";

export type TimelineEntry =
  | { kind: "inquiry"; id: string; at: string; author: string | null; body: string; attachments: AttachmentWithUrl[] }
  | { kind: "outbound"; id: string; at: string; author: string | null; body: string }
  | { kind: "inbound"; id: string; at: string; author: string | null; body: string }
  | { kind: "note"; id: string; at: string; author: string; body: string };

/**
 * 문의 본문, 보낸 답변, 사용자 회신, 내부 메모를 대화 한 줄기로 합친다.
 * 본문은 항상 첫 항목이고 나머지는 시각 오름차순. 같은 시각이면 입력 순서
 * (메시지 → 메모)를 지킨다 — Array.prototype.sort는 안정 정렬이다.
 */
export function buildTimeline(
  inquiry: InquiryRow,
  attachments: AttachmentWithUrl[],
  messages: MessageRow[],
  notes: NoteRow[]
): TimelineEntry[] {
  const head: TimelineEntry = {
    kind: "inquiry",
    id: inquiry.id,
    at: inquiry.createdAt,
    author: inquiry.gameAccount,
    body: inquiry.content,
    attachments,
  };

  const rest: TimelineEntry[] = [
    ...messages.map(
      (message): TimelineEntry => ({
        kind: message.direction,
        id: message.id,
        at: message.sentAt,
        author: message.authorEmail,
        body: message.body,
      })
    ),
    ...notes.map(
      (note): TimelineEntry => ({
        kind: "note",
        id: note.id,
        at: note.createdAt,
        author: note.authorEmail,
        body: note.content,
      })
    ),
  ];

  rest.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return [head, ...rest];
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/lib/timeline.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/timeline.ts tests/lib/timeline.test.ts
git commit -m "feat: merge inquiry, messages, and notes into one timeline"
```

---

### Task 6: `inquiryMetaRows`와 `AccountHistoryPanel` 링크

**Files:**
- Modify: `lib/format.ts`, `components/inquiries/InquiryMetaCard.tsx`, `components/inquiries/AccountHistoryPanel.tsx`
- Modify: `app/(admin)/inquiries/[id]/page.tsx` (AccountHistoryPanel에 `gameId` 전달)
- Test: `tests/lib/format.test.ts`, `tests/components/AccountHistoryPanel.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  inquiryMetaRows(inquiry: InquiryRow): Array<{ key: string; label: string; value: string }>
  AccountHistoryPanel props: { history; gameAccount; currentTypeKey?; gameId: string; frameless?: boolean }
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/lib/format.test.ts`에 추가 (import에 `inquiryMetaRows` 추가; `InquiryRow` 타입 import):

```ts
describe("inquiryMetaRows", () => {
  const base: InquiryRow = {
    id: "inq-1",
    inquiryNo: "R-20260723-0005",
    gameId: "game-1",
    groupKey: "game_usage",
    typeKey: "bug_report",
    gameAccount: "player1",
    companyName: null,
    replyEmail: "user@example.com",
    title: "제목",
    content: "본문",
    status: "new",
    priority: "normal",
    meta: { device: "iPhone 15", app_version: "2.4.1" },
    draftReply: null,
    replyContent: null,
    repliedAt: null,
    gmailThreadId: null,
    createdAt: "2026-07-23T13:55:00.000Z",
  };

  it("lists fixed rows with values, then meta entries in the known order", () => {
    const rows = inquiryMetaRows(base);
    expect(rows.map((r) => r.label)).toEqual(["게임 계정", "회신 이메일", "접수 시각", "앱 버전", "기기"]);
    expect(rows[0].value).toBe("player1");
  });

  it("skips empty fixed rows", () => {
    const rows = inquiryMetaRows({ ...base, gameAccount: "  ", meta: {} });
    expect(rows.map((r) => r.label)).toEqual(["회신 이메일", "접수 시각"]);
  });
});
```

`tests/components/AccountHistoryPanel.test.tsx`: 모든 `render(<AccountHistoryPanel ... />)`에 `gameId="game-1"`을 더하고, 링크 기대(37행 근처)를 `"/games/game-1/inquiries/inq-2"`로 바꾼다. 추가:

```ts
  it("drops the card frame when frameless", () => {
    const { container } = render(<AccountHistoryPanel history={[]} gameAccount={null} gameId="game-1" frameless />);
    expect(container.firstElementChild).not.toHaveClass("border");
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/lib/format.test.ts tests/components/AccountHistoryPanel.test.tsx`
Expected: FAIL

- [ ] **Step 3: 구현**

`lib/format.ts` 끝에 (상단에 `import type { InquiryRow } from "@/lib/inquiries";`):

```ts
/** 상세 패널 "접수 정보"의 행. 값이 빈 고정 항목은 건너뛰고 meta는 metaEntries 순서를 따른다. */
export function inquiryMetaRows(inquiry: InquiryRow): MetaEntry[] {
  const fixed: Array<{ label: string; value: string | null }> = [
    { label: "게임 계정", value: inquiry.gameAccount },
    { label: "회사명", value: inquiry.companyName },
    { label: "회신 이메일", value: inquiry.replyEmail },
    { label: "접수 시각", value: formatReceivedAt(inquiry.createdAt) },
  ];
  return [
    ...fixed
      .filter((row) => row.value && row.value.trim() !== "")
      .map((row) => ({ key: row.label, label: row.label, value: row.value as string })),
    ...metaEntries(inquiry.meta),
  ];
}
```

`components/inquiries/InquiryMetaCard.tsx`: 내부의 `fixed`/`rows` 계산을 지우고 `const rows = inquiryMetaRows(inquiry);`로 바꾼다 (import 수정). 기존 테스트가 그대로 통과해야 한다.

`components/inquiries/AccountHistoryPanel.tsx`:

```tsx
export default function AccountHistoryPanel({
  history,
  gameAccount,
  currentTypeKey = null,
  gameId,
  frameless = false,
}: {
  history: AccountHistoryEntry[];
  gameAccount: string | null;
  currentTypeKey?: string | null;
  /** 이력 항목 링크가 이 게임의 인박스 URL을 가리킨다. */
  gameId: string;
  /** 상세 패널 안에 넣을 때는 카드 테두리 없이. */
  frameless?: boolean;
}) {
  const summary = summarizeHistory(history, currentTypeKey);

  return (
    <aside className={frameless ? "flex flex-col gap-4" : "border border-line rounded-xl p-4 bg-panel flex flex-col gap-4"}>
```

링크 href를 `` `/games/${gameId}/inquiries/${entry.id}` ``로 바꾼다. `app/(admin)/inquiries/[id]/page.tsx`의 `<AccountHistoryPanel ... />`에 `gameId={inquiry.gameId}`를 더한다 (이 페이지는 Task 14에서 교체된다).

- [ ] **Step 4: 통과 확인**

Run: `npm test && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/format.ts tests/lib/format.test.ts components/inquiries/InquiryMetaCard.tsx components/inquiries/AccountHistoryPanel.tsx tests/components/AccountHistoryPanel.test.tsx "app/(admin)/inquiries/[id]/page.tsx"
git commit -m "refactor: extract inquiryMetaRows and point history links at the inbox"
```

---

### Task 7: `InboxNav` + `InboxSearch`

**Files:**
- Create: `components/inbox/InboxSearch.tsx`, `components/inbox/InboxNav.tsx`
- Test: `tests/components/InboxSearch.test.tsx`, `tests/components/InboxNav.test.tsx`

**Interfaces:**
- Consumes: `inboxHref`, `InquiryListQuery` (Task 1), `InquiryFacetCounts` (Task 3), `CategoryLabelMaps.typeOrder` (Task 4), `GameRow`, `DeleteGameButton`.
- Produces:
  ```tsx
  <InboxSearch gameId query selectedId />
  <InboxNav game query labels counts selectedId />
  ```

- [ ] **Step 1: `InboxSearch` 테스트 작성**

`tests/components/InboxSearch.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InboxSearch from "@/components/inbox/InboxSearch";
import { DEFAULT_QUERY } from "@/lib/inquiry-filters";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

describe("InboxSearch", () => {
  beforeEach(() => replace.mockReset());

  it("shows the current term", () => {
    render(<InboxSearch gameId="g1" query={{ ...DEFAULT_QUERY, q: "환불" }} selectedId={null} />);
    expect(screen.getByLabelText("검색")).toHaveValue("환불");
  });

  it("debounces typing into the URL and resets the page", async () => {
    render(<InboxSearch gameId="g1" query={{ ...DEFAULT_QUERY, page: 3 }} selectedId={null} />);
    await userEvent.type(screen.getByLabelText("검색"), "결제");
    expect(replace).not.toHaveBeenCalled();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/games/g1/inquiries?q=%EA%B2%B0%EC%A0%9C"));
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("keeps the selected inquiry in the URL", async () => {
    render(<InboxSearch gameId="g1" query={DEFAULT_QUERY} selectedId="i1" />);
    await userEvent.type(screen.getByLabelText("검색"), "a");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/games/g1/inquiries/i1?q=a"));
  });
});
```

- [ ] **Step 2: `InboxNav` 테스트 작성**

`tests/components/InboxNav.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import InboxNav from "@/components/inbox/InboxNav";
import { DEFAULT_QUERY, type InquiryListQuery } from "@/lib/inquiry-filters";
import type { InquiryFacetCounts } from "@/lib/inquiries";
import type { GameRow } from "@/lib/categories";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));

const game: GameRow = { id: "g1", name: "아르카나 사가", status: "active", logoPath: null, ownerName: null, createdAt: "2026-01-01T00:00:00.000Z" };

const labels = {
  groupLabels: { game_usage: "게임 이용 문의" },
  typeLabels: { account_login: "계정/로그인", payment_refund: "결제/환불" },
  typeOrder: ["account_login", "payment_refund"],
};

const counts: InquiryFacetCounts = {
  total: 23,
  status: { new: 4, in_progress: 7, resolved: 12 },
  type: { account_login: 6, payment_refund: 8 },
  priority: { urgent: 1, high: 3, normal: 10, low: 9 },
  stale: 2,
};

function renderNav(query: InquiryListQuery = DEFAULT_QUERY, c: InquiryFacetCounts | null = counts, selectedId: string | null = null) {
  return render(<InboxNav game={game} query={query} labels={labels} counts={c} selectedId={selectedId} />);
}

describe("InboxNav", () => {
  it("shows the game, its status, and the total", () => {
    renderNav();
    expect(screen.getByText("아르카나 사가")).toBeInTheDocument();
    expect(screen.getByText("서비스중")).toBeInTheDocument();
    expect(screen.getByText("문의함 · 전체 23건")).toBeInTheDocument();
  });

  it("links each view to a query that resets the page", () => {
    renderNav({ ...DEFAULT_QUERY, page: 3, sort: "oldest" });
    expect(screen.getByRole("link", { name: /^접수/ })).toHaveAttribute("href", "/games/g1/inquiries?status=new&sort=oldest");
    expect(screen.getByRole("link", { name: /^처리중/ })).toHaveAttribute("href", "/games/g1/inquiries?status=in_progress&sort=oldest");
    expect(screen.getByRole("link", { name: /^3일 이상 미처리/ })).toHaveAttribute("href", "/games/g1/inquiries?stale=1&sort=oldest");
  });

  it("전체 clears status, stale, priority, and type but keeps the search and sort", () => {
    renderNav({ ...DEFAULT_QUERY, status: "new", type: "account_login", priority: "high", stale: true, q: "x", sort: "priority" });
    expect(screen.getByRole("link", { name: /^전체/ })).toHaveAttribute("href", "/games/g1/inquiries?q=x&sort=priority");
  });

  it("marks the active view, type, and priority", () => {
    renderNav({ ...DEFAULT_QUERY, status: "new", type: "payment_refund", priority: "urgent" });
    expect(screen.getByRole("link", { name: /^접수/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: /^전체/ })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: /결제\/환불/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: /긴급/ })).toHaveAttribute("aria-current", "true");
  });

  it("stale view is active only when stale is set", () => {
    renderNav({ ...DEFAULT_QUERY, stale: true });
    expect(screen.getByRole("link", { name: /^3일 이상 미처리/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: /^전체/ })).not.toHaveAttribute("aria-current");
  });

  it("lists types in typeOrder with counts and links", () => {
    renderNav();
    const list = screen.getByRole("list", { name: "유형" });
    const links = within(list).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["계정/로그인6", "결제/환불8"]);
    expect(links[1]).toHaveAttribute("href", "/games/g1/inquiries?type=payment_refund");
  });

  it("shows the new badge only when there is something new", () => {
    renderNav(DEFAULT_QUERY, { ...counts, status: { ...counts.status, new: 0 } });
    expect(within(screen.getByRole("link", { name: /^접수/ })).queryByText("0")).not.toBeInTheDocument();
  });

  it("renders without numbers when counts are unavailable", () => {
    renderNav(DEFAULT_QUERY, null);
    expect(screen.getByText("문의함")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "접수" })).toBeInTheDocument();
  });

  it("keeps the selected inquiry when switching views", () => {
    renderNav(DEFAULT_QUERY, counts, "i1");
    expect(screen.getByRole("link", { name: /^처리중/ })).toHaveAttribute("href", "/games/g1/inquiries/i1?status=in_progress");
  });

  it("links to templates and offers game deletion", () => {
    renderNav();
    expect(screen.getByRole("link", { name: "답변 템플릿" })).toHaveAttribute("href", "/games/g1/templates");
    expect(screen.getByRole("button", { name: /삭제/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run tests/components/InboxSearch.test.tsx tests/components/InboxNav.test.tsx`
Expected: FAIL — 모듈 없음.

- [ ] **Step 4: `InboxSearch` 구현**

`components/inbox/InboxSearch.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { inboxHref, type InquiryListQuery } from "@/lib/inquiry-filters";

const SEARCH_DEBOUNCE_MS = 300;

/** 문의함 보기 열의 검색창. 입력을 300ms 모았다가 URL의 q로 옮기고 1페이지로 돌아간다. */
export default function InboxSearch({
  gameId,
  query,
  selectedId,
}: {
  gameId: string;
  query: InquiryListQuery;
  selectedId: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(query.q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 뒤로 가기 등으로 URL의 q가 바뀌면 입력창도 맞춘다.
  useEffect(() => {
    setValue(query.q);
  }, [query.q]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function handleChange(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      router.replace(inboxHref(gameId, selectedId, { ...query, q: next.trim(), page: 1 }));
    }, SEARCH_DEBOUNCE_MS);
  }

  return (
    <label className="flex items-center gap-2 h-[34px] px-2.5 border border-line rounded-lg bg-ground text-muted focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/40 transition-colors">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <line x1="20" y1="20" x2="16.5" y2="16.5" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="제목·접수번호·계정·본문 검색"
        aria-label="검색"
        className="flex-1 min-w-0 bg-transparent text-[13px] text-ink placeholder:text-muted focus:outline-none"
      />
    </label>
  );
}
```

- [ ] **Step 5: `InboxNav` 구현**

`components/inbox/InboxNav.tsx`:

```tsx
import Link from "next/link";
import type { GameRow, CategoryLabelMaps } from "@/lib/categories";
import type { InquiryFacetCounts, InquiryPriority, InquiryStatus } from "@/lib/inquiries";
import { inboxHref, type InquiryListQuery } from "@/lib/inquiry-filters";
import InboxSearch from "@/components/inbox/InboxSearch";
import DeleteGameButton from "@/components/games/DeleteGameButton";

type ViewKey = InquiryStatus | "all" | "stale";

const VIEWS: Array<{ key: ViewKey; label: string; patch: Partial<InquiryListQuery> }> = [
  { key: "new", label: "접수", patch: { status: "new", stale: false } },
  { key: "in_progress", label: "처리중", patch: { status: "in_progress", stale: false } },
  { key: "resolved", label: "완료", patch: { status: "resolved", stale: false } },
  { key: "all", label: "전체", patch: { status: null, stale: false, priority: null, type: null, group: null } },
  { key: "stale", label: "3일 이상 미처리", patch: { status: null, stale: true } },
];

const PRIORITY_VIEWS: Array<{ key: InquiryPriority; label: string; dot: string }> = [
  { key: "urgent", label: "긴급", dot: "bg-red-600" },
  { key: "high", label: "높음", dot: "bg-amber-600" },
];

function isViewActive(key: ViewKey, query: InquiryListQuery): boolean {
  if (key === "stale") return query.stale;
  if (key === "all") return !query.status && !query.stale && !query.priority && !query.type;
  return query.status === key && !query.stale;
}

const ITEM = "flex items-center justify-between gap-2 h-[34px] px-2.5 rounded-lg text-[13px] transition-colors";
const ITEM_IDLE = "text-muted hover:bg-ground hover:text-ink";
const ITEM_ACTIVE = "bg-ground text-ink font-semibold";

/** 문의함 보기 열. 각 항목은 현재 쿼리에서 해당 필터만 바꾼 링크다. 건수는 부가 정보라 없어도 그린다. */
export default function InboxNav({
  game,
  query,
  labels,
  counts,
  selectedId,
}: {
  game: GameRow;
  query: InquiryListQuery;
  labels: CategoryLabelMaps;
  counts: InquiryFacetCounts | null;
  selectedId: string | null;
}) {
  const href = (patch: Partial<InquiryListQuery>) => inboxHref(game.id, selectedId, { ...query, ...patch, page: 1 });

  return (
    <aside className="w-[224px] shrink-0 h-full bg-panel border-r border-line flex flex-col gap-4 px-3 py-4 overflow-y-auto" aria-label="문의함 보기">
      <div className="flex flex-col gap-1.5 px-1">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-base font-bold truncate">{game.name}</h1>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium shrink-0 ${
              game.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-ground text-muted"
            }`}
          >
            {game.status === "active" ? "서비스중" : "종료"}
          </span>
        </div>
        <p className="text-xs text-muted">{counts ? `문의함 · 전체 ${counts.total}건` : "문의함"}</p>
      </div>

      <InboxSearch gameId={game.id} query={query} selectedId={selectedId} />

      <ul className="flex flex-col gap-0.5" aria-label="보기">
        {VIEWS.map((view) => {
          const active = isViewActive(view.key, query);
          let count: number | null = null;
          if (counts) {
            count =
              view.key === "all" ? counts.total : view.key === "stale" ? counts.stale : counts.status[view.key];
          }
          return (
            <li key={view.key}>
              <Link href={href(view.patch)} aria-current={active ? "true" : undefined} className={`${ITEM} ${active ? ITEM_ACTIVE : ITEM_IDLE}`}>
                <span>{view.label}</span>
                {count !== null && view.key === "new" && count > 0 && (
                  <span className="inline-flex min-w-[20px] h-[18px] px-1.5 rounded-full bg-accent/10 text-accent text-[11px] font-semibold leading-[18px] justify-center">
                    {count}
                  </span>
                )}
                {count !== null && view.key !== "new" && (
                  <span className={`text-xs font-normal ${view.key === "stale" && count > 0 ? "text-accent font-semibold" : "text-muted"}`}>{count}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-0.5">
        <h2 className="px-2.5 pb-1.5 text-[11px] font-semibold text-muted tracking-wide">유형</h2>
        <ul className="flex flex-col gap-0.5" aria-label="유형">
          {labels.typeOrder.map((key) => {
            const active = query.type === key;
            return (
              <li key={key}>
                <Link href={href({ type: key, group: null })} aria-current={active ? "true" : undefined} className={`${ITEM} h-8 ${active ? ITEM_ACTIVE : ITEM_IDLE}`}>
                  <span className="truncate">{labels.typeLabels[key] ?? key}</span>
                  {counts && <span className="text-xs font-normal text-muted">{counts.type[key] ?? 0}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-col gap-0.5">
        <h2 className="px-2.5 pb-1.5 text-[11px] font-semibold text-muted tracking-wide">우선순위</h2>
        <ul className="flex flex-col gap-0.5" aria-label="우선순위">
          {PRIORITY_VIEWS.map((item) => {
            const active = query.priority === item.key;
            return (
              <li key={item.key}>
                <Link href={href({ priority: item.key })} aria-current={active ? "true" : undefined} className={`${ITEM} h-8 ${active ? ITEM_ACTIVE : ITEM_IDLE}`}>
                  <span className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${item.dot}`} aria-hidden="true" />
                    <span>{item.label}</span>
                  </span>
                  {counts && <span className="text-xs font-normal text-muted">{counts.priority[item.key]}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex-1" />

      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <Link href={`/games/${game.id}/templates`} className={`${ITEM} h-8 ${ITEM_IDLE}`}>
          답변 템플릿
        </Link>
        <div className="px-2.5">
          <DeleteGameButton gameId={game.id} gameName={game.name} inquiryCount={counts?.total ?? 0} />
        </div>
      </div>
    </aside>
  );
}
```

`DeleteGameButton`의 버튼 문구가 "삭제"를 포함하는지 확인한다 (`grep -n "삭제" components/games/DeleteGameButton.tsx`). 포함하지 않으면 테스트의 정규식을 실제 문구로 맞춘다.

- [ ] **Step 6: 통과 확인**

Run: `npx vitest run tests/components/InboxSearch.test.tsx tests/components/InboxNav.test.tsx && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add components/inbox/InboxSearch.tsx components/inbox/InboxNav.tsx tests/components/InboxSearch.test.tsx tests/components/InboxNav.test.tsx
git commit -m "feat: inbox view navigation with counts and search"
```

---

### Task 8: `InboxList`

**Files:**
- Create: `components/inbox/InboxList.tsx`
- Test: `tests/components/InboxList.test.tsx`

**Interfaces:**
- Consumes: `inquiryHref`, `inboxHref`, `SORT_OPTIONS` (Task 1), `InquiryPage`, `StatusBadge`, `formatElapsed`.
- Produces: `<InboxList gameId page query labels selectedId viewLabel />`

- [ ] **Step 1: 테스트 작성**

`tests/components/InboxList.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InboxList from "@/components/inbox/InboxList";
import type { InquiryPage, InquiryRow } from "@/lib/inquiries";
import { DEFAULT_QUERY, type InquiryListQuery } from "@/lib/inquiry-filters";

const push = vi.fn();
const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace, refresh }) }));

function makeInquiry(overrides: Partial<InquiryRow>): InquiryRow {
  return {
    id: "aaaabbbb-0000-0000-0000-000000000000",
    gameId: "g1",
    groupKey: "game_usage",
    typeKey: "bug_report",
    gameAccount: "user#1234",
    companyName: null,
    replyEmail: "user@example.com",
    title: "버그 신고합니다",
    content: "첫 줄입니다\n둘째 줄",
    status: "new",
    priority: "normal",
    meta: {},
    draftReply: null,
    inquiryNo: "R-20260101-0001",
    replyContent: null,
    repliedAt: null,
    gmailThreadId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makePage(rows: InquiryRow[], total = rows.length, page = 1, pageSize = 50): InquiryPage {
  return { rows, total, page, pageSize };
}

const labels = {
  groupLabels: { game_usage: "게임 이용 문의" },
  typeLabels: { bug_report: "버그·오류 신고" },
  typeOrder: ["bug_report"],
};

function renderList(page: InquiryPage, query: InquiryListQuery = DEFAULT_QUERY, selectedId: string | null = null) {
  return render(<InboxList gameId="g1" page={page} query={query} labels={labels} selectedId={selectedId} viewLabel="전체" />);
}

describe("InboxList", () => {
  beforeEach(() => {
    push.mockReset();
    replace.mockReset();
    refresh.mockReset();
  });

  it("shows the view label and total", () => {
    renderList(makePage([makeInquiry({})], 37));
    expect(screen.getByText("전체")).toBeInTheDocument();
    expect(screen.getByText("37건")).toBeInTheDocument();
  });

  it("renders a card row with number, elapsed, title, first content line, badge, type, and priority", () => {
    renderList(makePage([makeInquiry({ priority: "urgent" })]));
    expect(screen.getByText("R-20260101-0001")).toBeInTheDocument();
    expect(screen.getByText("0분")).toBeInTheDocument();
    expect(screen.getByText("버그 신고합니다")).toBeInTheDocument();
    expect(screen.getByText("첫 줄입니다")).toBeInTheDocument();
    expect(screen.queryByText(/둘째 줄/)).not.toBeInTheDocument();
    expect(screen.getByText("접수")).toBeInTheDocument();
    expect(screen.getByText("버그·오류 신고")).toBeInTheDocument();
    expect(screen.getByText("긴급")).toBeInTheDocument();
  });

  it("hides normal and low priority", () => {
    renderList(makePage([makeInquiry({ priority: "low" })]));
    expect(screen.queryByText("낮음")).not.toBeInTheDocument();
  });

  it("navigates to the inquiry keeping the query when a row is clicked", async () => {
    renderList(makePage([makeInquiry({})]), { ...DEFAULT_QUERY, status: "new" });
    await userEvent.click(screen.getByText("버그 신고합니다"));
    expect(push).toHaveBeenCalledWith("/games/g1/inquiries/aaaabbbb-0000-0000-0000-000000000000?status=new");
  });

  it("marks the selected row", () => {
    renderList(makePage([makeInquiry({})]), DEFAULT_QUERY, "aaaabbbb-0000-0000-0000-000000000000");
    expect(screen.getByRole("listitem")).toHaveAttribute("aria-current", "true");
  });

  it("changing the sort rewrites the URL and keeps the selection", async () => {
    renderList(makePage([]), DEFAULT_QUERY, "i1");
    await userEvent.selectOptions(screen.getByLabelText("정렬"), "priority");
    expect(replace).toHaveBeenCalledWith("/games/g1/inquiries/i1?sort=priority");
  });

  it("shows empty states", () => {
    renderList(makePage([]));
    expect(screen.getByText("접수된 문의가 없습니다.")).toBeInTheDocument();
    renderList(makePage([]), { ...DEFAULT_QUERY, status: "resolved" });
    expect(screen.getByText("조건에 맞는 문의가 없습니다.")).toBeInTheDocument();
  });

  describe("pagination", () => {
    it("shows only the range when everything fits", () => {
      renderList(makePage([makeInquiry({})], 10));
      expect(screen.getByText("1–10 / 10건")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "다음" })).not.toBeInTheDocument();
    });

    it("moves between pages without resetting filters", async () => {
      renderList(makePage([makeInquiry({})], 120, 2), { ...DEFAULT_QUERY, status: "new", page: 2 });
      expect(screen.getByText("51–100 / 120건")).toBeInTheDocument();
      expect(screen.getByText("2 / 3")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "다음" }));
      expect(replace).toHaveBeenCalledWith("/games/g1/inquiries?status=new&page=3");
      await userEvent.click(screen.getByRole("button", { name: "이전" }));
      expect(replace).toHaveBeenCalledWith("/games/g1/inquiries?status=new");
    });

    it("disables the edge buttons", () => {
      renderList(makePage([makeInquiry({})], 120, 3), { ...DEFAULT_QUERY, page: 3 });
      expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "이전" })).not.toBeDisabled();
    });
  });

  describe("bulk status", () => {
    const rows = [
      makeInquiry({ id: "11111111-0000-0000-0000-000000000000", title: "첫째" }),
      makeInquiry({ id: "22222222-0000-0000-0000-000000000000", title: "둘째" }),
    ];

    it("hides the bulk bar until something is selected", () => {
      renderList(makePage(rows));
      expect(screen.queryByRole("button", { name: "상태 변경" })).not.toBeInTheDocument();
    });

    it("selects all, applies the chosen status, and refreshes", async () => {
      global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true, updated: 2 }) }) as never;
      renderList(makePage(rows));

      await userEvent.click(screen.getByLabelText("이 페이지 전체 선택"));
      expect(screen.getByText("선택 2건")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "상태 변경" }));

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/inquiries/bulk-status",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            ids: ["11111111-0000-0000-0000-000000000000", "22222222-0000-0000-0000-000000000000"],
            status: "resolved",
          }),
        })
      );
      expect(await screen.findByText("2건의 상태를 변경했습니다.")).toBeInTheDocument();
      expect(refresh).toHaveBeenCalled();
      expect(screen.queryByText("선택 2건")).not.toBeInTheDocument();
    });

    it("lets the admin pick a different target status", async () => {
      global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true, updated: 1 }) }) as never;
      renderList(makePage(rows));
      await userEvent.click(screen.getByLabelText("첫째 선택"));
      await userEvent.selectOptions(screen.getByLabelText("일괄 변경 상태"), "in_progress");
      await userEvent.click(screen.getByRole("button", { name: "상태 변경" }));
      const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body).toEqual({ ids: ["11111111-0000-0000-0000-000000000000"], status: "in_progress" });
    });

    it("does not navigate when the checkbox is clicked", async () => {
      renderList(makePage(rows));
      await userEvent.click(screen.getByLabelText("첫째 선택"));
      expect(push).not.toHaveBeenCalled();
    });

    it("shows an error and keeps the selection when the request fails", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("down")) as never;
      renderList(makePage(rows));
      await userEvent.click(screen.getByLabelText("첫째 선택"));
      await userEvent.click(screen.getByRole("button", { name: "상태 변경" }));
      expect(await screen.findByText("상태 변경에 실패했습니다.")).toBeInTheDocument();
      expect(screen.getByText("선택 1건")).toBeInTheDocument();
      expect(refresh).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/InboxList.test.tsx`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`components/inbox/InboxList.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { InquiryPage, InquiryRow, InquiryStatus } from "@/lib/inquiries";
import type { CategoryLabelMaps } from "@/lib/categories";
import { SORT_OPTIONS, inboxHref, inquiryHref, type InquiryListQuery } from "@/lib/inquiry-filters";
import StatusBadge from "@/components/ui/StatusBadge";
import { formatElapsed } from "@/lib/format";

const STATUS_OPTIONS: Array<{ value: InquiryStatus; label: string }> = [
  { value: "new", label: "접수" },
  { value: "in_progress", label: "처리중" },
  { value: "resolved", label: "완료" },
];

/** 보통·낮음은 소음이라 표시하지 않는다. */
const PRIORITY_MARK: Partial<Record<InquiryRow["priority"], { label: string; className: string }>> = {
  urgent: { label: "긴급", className: "text-red-600 font-semibold" },
  high: { label: "높음", className: "text-amber-600 font-medium" },
};

const SELECT = "bg-panel border border-line rounded-lg px-2 py-1 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors";

function hasFilter(query: InquiryListQuery): boolean {
  return Boolean(query.group || query.type || query.status || query.priority || query.stale || query.q);
}

function firstLine(content: string): string {
  return content.split("\n").find((line) => line.trim() !== "")?.trim() ?? "";
}

export default function InboxList({
  gameId,
  page,
  query,
  labels,
  selectedId,
  viewLabel,
}: {
  gameId: string;
  page: InquiryPage;
  query: InquiryListQuery;
  labels: CategoryLabelMaps;
  selectedId: string | null;
  /** 머리에 보여줄 현재 보기 이름 (접수, 처리중, 전체 …). */
  viewLabel: string;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<InquiryStatus>("resolved");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);

  const { rows, total, pageSize } = page;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const firstIndex = total === 0 ? 0 : (query.page - 1) * pageSize + 1;
  const lastIndex = Math.min(total, query.page * pageSize);

  // 서버가 준 목록이 바뀌면 체크는 의미를 잃는다.
  useEffect(() => {
    setChecked(new Set());
  }, [rows]);

  function navigate(next: Partial<InquiryListQuery>, resetPage = true) {
    const merged: InquiryListQuery = { ...query, ...next, page: resetPage ? 1 : next.page ?? query.page };
    router.replace(inboxHref(gameId, selectedId, merged));
  }

  const allChecked = rows.length > 0 && rows.every((row) => checked.has(row.id));

  function toggleAll() {
    setChecked(allChecked ? new Set() : new Set(rows.map((row) => row.id)));
  }

  function toggleOne(id: string) {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function applyBulkStatus() {
    if (checked.size === 0) return;
    setBulkBusy(true);
    setBulkMessage(null);

    let json: { success: boolean; updated?: number };
    try {
      const response = await fetch("/api/inquiries/bulk-status", {
        method: "POST",
        body: JSON.stringify({ ids: Array.from(checked), status: bulkStatus }),
      });
      json = await response.json();
    } catch {
      setBulkBusy(false);
      setBulkMessage("상태 변경에 실패했습니다.");
      return;
    }
    setBulkBusy(false);

    if (!json.success) {
      setBulkMessage("상태 변경에 실패했습니다.");
      return;
    }
    setBulkMessage(`${json.updated ?? 0}건의 상태를 변경했습니다.`);
    setChecked(new Set());
    router.refresh();
  }

  return (
    <section className="w-[340px] shrink-0 h-full bg-panel border-r border-line flex flex-col overflow-hidden" aria-label="문의 목록">
      <header className="flex items-center justify-between gap-2 h-[52px] px-4 border-b border-line shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="이 페이지 전체 선택" className="accent-accent" />
          <span className="text-[13px] font-semibold truncate">
            <span>{viewLabel}</span> <span className="text-muted font-normal">{total}건</span>
          </span>
        </div>
        <select value={query.sort} onChange={(e) => navigate({ sort: e.target.value as InquiryListQuery["sort"] })} className={SELECT} aria-label="정렬">
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </header>

      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">
            {hasFilter(query) ? "조건에 맞는 문의가 없습니다." : "접수된 문의가 없습니다."}
          </p>
        ) : (
          <ul>
            {rows.map((inquiry) => {
              const elapsed = formatElapsed(inquiry.createdAt);
              const stale = inquiry.status !== "resolved" && elapsed.endsWith("일");
              const selected = inquiry.id === selectedId;
              const priority = PRIORITY_MARK[inquiry.priority];
              return (
                <li
                  key={inquiry.id}
                  onClick={() => router.push(inquiryHref(gameId, inquiry.id, query))}
                  aria-current={selected ? "true" : undefined}
                  className={`flex gap-2 px-4 py-3 border-b border-line cursor-pointer transition-colors border-l-2 ${
                    selected || inquiry.status === "new" ? "border-l-accent" : "border-l-transparent"
                  } ${selected || checked.has(inquiry.id) ? "bg-accent/5" : "hover:bg-ground/60"}`}
                >
                  <input
                    type="checkbox"
                    checked={checked.has(inquiry.id)}
                    onChange={() => toggleOne(inquiry.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`${inquiry.title} 선택`}
                    className="accent-accent mt-0.5"
                  />
                  <div className="flex flex-col gap-1 min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-muted">
                      <span>{inquiry.inquiryNo ?? "—"}</span>
                      <span className={stale ? "text-accent font-semibold" : ""}>{elapsed}</span>
                    </div>
                    <p className="text-sm font-semibold text-ink truncate">{inquiry.title}</p>
                    <p className="text-xs text-muted truncate">{firstLine(inquiry.content)}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 text-xs">
                      <StatusBadge status={inquiry.status} />
                      <span className="text-muted truncate">{labels.typeLabels[inquiry.typeKey] ?? inquiry.typeKey}</span>
                      {priority && <span className={`ml-auto ${priority.className}`}>{priority.label}</span>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {checked.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-t border-line bg-accent/5 text-xs shrink-0">
          <span className="font-medium">선택 {checked.size}건</span>
          <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value as InquiryStatus)} className={SELECT} aria-label="일괄 변경 상태">
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button type="button" onClick={applyBulkStatus} disabled={bulkBusy} className="bg-accent text-white rounded-lg px-3 py-1 hover:bg-accent/90 disabled:opacity-50 transition-colors">
            상태 변경
          </button>
          {bulkMessage && <span className="text-muted">{bulkMessage}</span>}
        </div>
      )}
      {checked.size === 0 && bulkMessage && (
        <p className="px-4 py-2 border-t border-line text-xs text-muted shrink-0">{bulkMessage}</p>
      )}

      <footer className="flex items-center justify-between gap-2 h-11 px-4 border-t border-line text-xs text-muted shrink-0" aria-label="페이지">
        <span>
          {firstIndex}–{lastIndex} / {total}건
        </span>
        {total > pageSize && (
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => navigate({ page: query.page - 1 }, false)} disabled={query.page <= 1} className="border border-line rounded-lg px-2 py-0.5 hover:bg-ground disabled:opacity-40 transition-colors">
              이전
            </button>
            <span className="font-mono">
              {query.page} / {totalPages}
            </span>
            <button type="button" onClick={() => navigate({ page: query.page + 1 }, false)} disabled={query.page >= totalPages} className="border border-line rounded-lg px-2 py-0.5 hover:bg-ground disabled:opacity-40 transition-colors">
              다음
            </button>
          </div>
        )}
      </footer>
    </section>
  );
}
```

주의: 일괄 변경 성공 메시지는 체크가 풀린 뒤에도 보여야 하므로(테스트 `findByText("2건의 상태를 변경했습니다.")`) 위처럼 두 자리 중 하나에 그린다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/components/InboxList.test.tsx && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add components/inbox/InboxList.tsx tests/components/InboxList.test.tsx
git commit -m "feat: card-style inbox list with selection and bulk status"
```

---

### Task 9: `InboxTimeline`

**Files:**
- Create: `components/inbox/InboxTimeline.tsx`
- Test: `tests/components/InboxTimeline.test.tsx`

**Interfaces:**
- Consumes: `TimelineEntry` (Task 5), `emailLocalPart`, `formatReceivedAt`.
- Produces: `<InboxTimeline entries />`

- [ ] **Step 1: 테스트 작성**

`tests/components/InboxTimeline.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import InboxTimeline from "@/components/inbox/InboxTimeline";
import type { TimelineEntry } from "@/lib/timeline";

const entries: TimelineEntry[] = [
  {
    kind: "inquiry",
    id: "inq-1",
    at: "2026-09-03T01:12:00.000Z",
    author: "luna_park",
    body: "두 번 결제됐어요",
    attachments: [
      { id: "a1", fileName: "명세서.png", signedUrl: "https://signed.example/a1" },
      { id: "a2", fileName: "깨짐.png", signedUrl: null },
    ],
  },
  { kind: "note", id: "n-1", at: "2026-09-03T01:40:00.000Z", author: "hong@theplayplus.com", body: "중복 승인 확인" },
  { kind: "outbound", id: "m-1", at: "2026-09-03T02:05:00.000Z", author: "info@theplayplus.com", body: "환불 처리했습니다" },
  { kind: "inbound", id: "m-2", at: "2026-09-03T04:48:00.000Z", author: "luna@example.com", body: "감사합니다" },
];

describe("InboxTimeline", () => {
  it("renders every entry with its label and body", () => {
    render(<InboxTimeline entries={entries} />);
    expect(screen.getByText("문의 접수")).toBeInTheDocument();
    expect(screen.getByText("두 번 결제됐어요")).toBeInTheDocument();
    expect(screen.getByText("내부 메모")).toBeInTheDocument();
    expect(screen.getByText("중복 승인 확인")).toBeInTheDocument();
    expect(screen.getByText("이메일 발송")).toBeInTheDocument();
    expect(screen.getByText("환불 처리했습니다")).toBeInTheDocument();
    expect(screen.getByText("이메일 회신")).toBeInTheDocument();
    expect(screen.getByText("감사합니다")).toBeInTheDocument();
  });

  it("shows the game account for the inquiry, the id part for staff, and the full email for replies", () => {
    render(<InboxTimeline entries={entries} />);
    expect(screen.getByText("luna_park")).toBeInTheDocument();
    expect(screen.getByText("hong")).toBeInTheDocument();
    expect(screen.getByText("info")).toBeInTheDocument();
    expect(screen.getByText("luna@example.com")).toBeInTheDocument();
  });

  it("renders attachment thumbnails and a failure note", () => {
    render(<InboxTimeline entries={entries} />);
    const img = screen.getByRole("img", { name: "명세서.png" });
    expect(img).toHaveAttribute("src", "https://signed.example/a1");
    expect(screen.getByText("깨짐.png (링크 생성 실패)")).toBeInTheDocument();
  });

  it("falls back to 사용자 when the inquiry has no account", () => {
    render(<InboxTimeline entries={[{ ...entries[0], author: null, attachments: [] }]} />);
    expect(screen.getByText("사용자")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/InboxTimeline.test.tsx`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`components/inbox/InboxTimeline.tsx`:

```tsx
import type { TimelineEntry } from "@/lib/timeline";
import type { AttachmentWithUrl } from "@/lib/inquiries";
import { emailLocalPart, formatReceivedAt } from "@/lib/format";

const LABEL: Record<TimelineEntry["kind"], string> = {
  inquiry: "문의 접수",
  inbound: "이메일 회신",
  outbound: "이메일 발송",
  note: "내부 메모",
};

function authorText(entry: TimelineEntry): string {
  switch (entry.kind) {
    case "inquiry":
      return entry.author ?? "사용자";
    case "inbound":
      return entry.author ?? "사용자";
    case "outbound":
      return entry.author ? emailLocalPart(entry.author) : "THE PLAY+ 고객지원";
    case "note":
      return emailLocalPart(entry.author);
  }
}

function Avatar({ entry }: { entry: TimelineEntry }) {
  if (entry.kind === "outbound") {
    return <div className="w-8 h-8 rounded-full bg-ink text-white flex items-center justify-center text-[11px] font-bold shrink-0">P+</div>;
  }
  if (entry.kind === "note") {
    return (
      <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
        </svg>
      </div>
    );
  }
  const initial = (entry.author ?? "?").charAt(0).toUpperCase();
  return <div className="w-8 h-8 rounded-full bg-accent/10 text-accent flex items-center justify-center text-xs font-bold shrink-0">{initial}</div>;
}

function Attachments({ attachments }: { attachments: AttachmentWithUrl[] }) {
  if (attachments.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2 text-xs">
      {attachments.map((attachment) => (
        <li key={attachment.id} className="flex flex-col gap-1 max-w-[240px]">
          {attachment.signedUrl ? (
            <>
              <a href={attachment.signedUrl} target="_blank" rel="noreferrer" title="원본 크기로 열기" className="block border border-line rounded-lg overflow-hidden bg-black/5">
                {/* 첨부 버킷은 이미지 MIME만 허용하므로 항상 <img>로 렌더링한다. */}
                <img src={attachment.signedUrl} alt={attachment.fileName} loading="lazy" className="max-h-48 w-auto object-contain" />
              </a>
              <span className="text-muted truncate">{attachment.fileName}</span>
            </>
          ) : (
            <span className="text-muted">{attachment.fileName} (링크 생성 실패)</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** 문의 본문·답변·회신·메모를 시간순 말풍선으로. 데이터 순서는 lib/timeline이 정한다. */
export default function InboxTimeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <ol className="flex flex-col gap-4">
      {entries.map((entry) => {
        const outbound = entry.kind === "outbound";
        const note = entry.kind === "note";
        return (
          <li key={`${entry.kind}-${entry.id}`} className={`flex gap-3 items-start ${outbound ? "flex-row-reverse" : ""}`} data-kind={entry.kind}>
            <Avatar entry={entry} />
            <div className={`flex flex-col gap-1.5 max-w-[640px] min-w-0 ${outbound ? "items-end" : ""}`}>
              <div className="flex items-baseline gap-2 text-xs">
                <span className={`font-semibold ${note ? "text-amber-700" : outbound ? "text-ink" : "text-accent"}`}>{authorText(entry)}</span>
                <span className="text-muted">{LABEL[entry.kind]}</span>
                <span className="text-muted font-mono">{formatReceivedAt(entry.at)}</span>
              </div>
              <div
                className={`rounded-xl border px-3.5 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                  note ? "bg-amber-50 border-amber-200 text-amber-900" : "bg-panel border-line"
                }`}
              >
                {entry.body}
              </div>
              {entry.kind === "inquiry" && <Attachments attachments={entry.attachments} />}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/components/InboxTimeline.test.tsx && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add components/inbox/InboxTimeline.tsx tests/components/InboxTimeline.test.tsx
git commit -m "feat: conversation timeline for inquiry, replies, and notes"
```

---

### Task 10: `ReplyComposer` + `NoteForm`

**Files:**
- Create: `components/inbox/NoteForm.tsx`, `components/inbox/ReplyComposer.tsx`
- Test: `tests/components/NoteForm.test.tsx`, `tests/components/ReplyComposer.test.tsx`

**Interfaces:**
- Consumes: `ReplyForm` (기존, 수정 없음), `TemplateRow`.
- Produces:
  ```tsx
  <NoteForm inquiryId />
  <ReplyComposer inquiryId replyEmail initialDraft templates typeKey />
  ```

- [ ] **Step 1: 테스트 작성**

`tests/components/NoteForm.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NoteForm from "@/components/inbox/NoteForm";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

describe("NoteForm", () => {
  beforeEach(() => {
    refresh.mockReset();
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true }) }) as never;
  });

  it("says notes are staff-only", () => {
    render(<NoteForm inquiryId="inq-1" />);
    expect(screen.getByText(/운영자 전용/)).toBeInTheDocument();
  });

  it("posts the note, clears the box, and refreshes", async () => {
    render(<NoteForm inquiryId="inq-1" />);
    await userEvent.type(screen.getByLabelText("내부 메모"), "확인함");
    await userEvent.click(screen.getByRole("button", { name: "메모 추가" }));
    expect(global.fetch).toHaveBeenCalledWith("/api/inquiries/inq-1/notes", expect.objectContaining({ method: "POST", body: JSON.stringify({ content: "확인함" }) }));
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByLabelText("내부 메모")).toHaveValue("");
  });

  it("does nothing for an empty note", async () => {
    render(<NoteForm inquiryId="inq-1" />);
    await userEvent.click(screen.getByRole("button", { name: "메모 추가" }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("shows an error when saving fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: false }) }) as never;
    render(<NoteForm inquiryId="inq-1" />);
    await userEvent.type(screen.getByLabelText("내부 메모"), "x");
    await userEvent.click(screen.getByRole("button", { name: "메모 추가" }));
    expect(await screen.findByText("메모 저장에 실패했습니다.")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
```

`tests/components/ReplyComposer.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReplyComposer from "@/components/inbox/ReplyComposer";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/inquiries/ReplyForm", () => ({ default: () => <div data-testid="reply-form" /> }));
vi.mock("@/components/inbox/NoteForm", () => ({ default: () => <div data-testid="note-form" /> }));

describe("ReplyComposer", () => {
  function renderIt() {
    return render(<ReplyComposer inquiryId="inq-1" replyEmail="user@example.com" initialDraft={null} templates={[]} typeKey="bug_report" />);
  }

  it("starts on the reply tab and shows the recipient", () => {
    renderIt();
    expect(screen.getByTestId("reply-form")).toBeInTheDocument();
    expect(screen.queryByTestId("note-form")).not.toBeInTheDocument();
    expect(screen.getByText("받는 사람 user@example.com")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "답변" })).toHaveAttribute("aria-selected", "true");
  });

  it("switches to the note tab", async () => {
    renderIt();
    await userEvent.click(screen.getByRole("tab", { name: "내부 메모" }));
    expect(screen.getByTestId("note-form")).toBeInTheDocument();
    expect(screen.queryByTestId("reply-form")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "내부 메모" })).toHaveAttribute("aria-selected", "true");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/NoteForm.test.tsx tests/components/ReplyComposer.test.tsx`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: `NoteForm` 구현**

`components/inbox/NoteForm.tsx`:

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

/** 내부 메모 작성. 저장되면 타임라인에 나타나므로 여기서는 목록을 그리지 않는다. */
export default function NoteForm({ inquiryId }: { inquiryId: string }) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = content.trim();
    if (trimmed === "") return;

    setSubmitting(true);
    setError(null);

    let json: { success: boolean };
    try {
      const response = await fetch(`/api/inquiries/${inquiryId}/notes`, {
        method: "POST",
        body: JSON.stringify({ content: trimmed }),
      });
      json = await response.json();
    } catch {
      setSubmitting(false);
      setError("메모 저장에 실패했습니다.");
      return;
    }
    setSubmitting(false);

    if (!json.success) {
      setError("메모 저장에 실패했습니다.");
      return;
    }
    setContent("");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <p className="text-xs text-muted">운영자 전용 · 사용자에게 보이지 않습니다.</p>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={4}
        placeholder="처리 과정, 확인한 내용 등을 기록합니다."
        aria-label="내부 메모"
        className="bg-ground border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
      />
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="flex justify-end">
        <button type="submit" disabled={submitting} className="border border-line rounded-lg px-3 py-1.5 text-sm hover:bg-ground disabled:opacity-50 transition-colors">
          메모 추가
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: `ReplyComposer` 구현**

`components/inbox/ReplyComposer.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { TemplateRow } from "@/lib/templates";
import ReplyForm from "@/components/inquiries/ReplyForm";
import NoteForm from "@/components/inbox/NoteForm";

type Tab = "reply" | "note";

/** 대화 열 바닥의 작성란. 답변(이메일 발송)과 내부 메모를 탭으로 오간다. */
export default function ReplyComposer({
  inquiryId,
  replyEmail,
  initialDraft,
  templates,
  typeKey,
}: {
  inquiryId: string;
  replyEmail: string;
  initialDraft: string | null;
  templates: TemplateRow[];
  typeKey: string;
}) {
  const [tab, setTab] = useState<Tab>("reply");

  const tabClass = (active: boolean) =>
    `h-7 px-2.5 inline-flex items-center rounded-md text-xs transition-colors ${
      active ? "bg-ground text-ink font-semibold" : "text-muted hover:text-ink"
    }`;

  return (
    <div className="flex flex-col gap-2.5 px-5 pt-3 pb-4 border-t border-line bg-panel">
      <div className="flex items-center gap-1" role="tablist" aria-label="작성 종류">
        <button type="button" role="tab" aria-selected={tab === "reply"} onClick={() => setTab("reply")} className={tabClass(tab === "reply")}>
          답변
        </button>
        <button type="button" role="tab" aria-selected={tab === "note"} onClick={() => setTab("note")} className={tabClass(tab === "note")}>
          내부 메모
        </button>
        {tab === "reply" && <span className="ml-auto text-[11px] text-muted truncate">받는 사람 {replyEmail}</span>}
      </div>
      {tab === "reply" ? (
        <ReplyForm inquiryId={inquiryId} initialDraft={initialDraft} templates={templates} typeKey={typeKey} />
      ) : (
        <NoteForm inquiryId={inquiryId} />
      )}
    </div>
  );
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/components/NoteForm.test.tsx tests/components/ReplyComposer.test.tsx && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add components/inbox/NoteForm.tsx components/inbox/ReplyComposer.tsx tests/components/NoteForm.test.tsx tests/components/ReplyComposer.test.tsx
git commit -m "feat: reply composer with reply and internal note tabs"
```

---

### Task 11: `InboxDetailPanel`

**Files:**
- Create: `components/inbox/InboxDetailPanel.tsx`
- Test: `tests/components/InboxDetailPanel.test.tsx`

**Interfaces:**
- Consumes: `inquiryMetaRows`, `AccountHistoryPanel(gameId, frameless)` (Task 6), `describeEvent`, `StatusSelect`, `PrioritySelect`.
- Produces: `<InboxDetailPanel inquiry events history />`

- [ ] **Step 1: 테스트 작성**

`tests/components/InboxDetailPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InboxDetailPanel from "@/components/inbox/InboxDetailPanel";
import type { InquiryRow } from "@/lib/inquiries";
import type { EventRow } from "@/lib/events";
import type { AccountHistoryEntry } from "@/lib/account-history";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const inquiry: InquiryRow = {
  id: "inq-1",
  inquiryNo: "R-20260903-0007",
  gameId: "game-1",
  groupKey: "game_usage",
  typeKey: "payment_refund",
  gameAccount: "luna_park",
  companyName: null,
  replyEmail: "luna@example.com",
  title: "중복 결제",
  content: "본문",
  status: "in_progress",
  priority: "high",
  meta: { device: "iPhone 15" },
  draftReply: null,
  replyContent: null,
  repliedAt: null,
  gmailThreadId: null,
  createdAt: "2026-09-03T01:12:00.000Z",
};

const events: EventRow[] = [
  { id: "e2", actorEmail: "hong@theplayplus.com", kind: "reply_sent", fromValue: null, toValue: null, createdAt: "2026-09-03T02:05:00.000Z" },
  { id: "e1", actorEmail: "hong@theplayplus.com", kind: "priority_changed", fromValue: "normal", toValue: "high", createdAt: "2026-09-03T01:38:00.000Z" },
];

const history: AccountHistoryEntry[] = [
  { id: "inq-0", title: "예전 문의", content: "…", status: "resolved", groupKey: "game_usage", typeKey: "payment_refund", createdAt: "2026-07-21T00:00:00.000Z" },
];

describe("InboxDetailPanel", () => {
  it("shows processing controls, meta rows, and the event log on the 상세 tab", () => {
    render(<InboxDetailPanel inquiry={inquiry} events={events} history={history} />);
    expect(screen.getByLabelText("상태")).toHaveValue("in_progress");
    expect(screen.getByLabelText("우선순위")).toHaveValue("high");
    expect(screen.getByText("게임 계정")).toBeInTheDocument();
    expect(screen.getByText("luna_park")).toBeInTheDocument();
    expect(screen.getByText("iPhone 15")).toBeInTheDocument();
    expect(screen.getByText("답변 발송")).toBeInTheDocument();
    expect(screen.getByText("우선순위 보통 → 높음")).toBeInTheDocument();
    // 상태 셀렉트의 <option>접수</option>과 구분하기 위해 span만 본다.
    expect(screen.getByText("접수", { selector: "span" })).toBeInTheDocument();
  });

  it("switches to the account history tab and shows the count", async () => {
    render(<InboxDetailPanel inquiry={inquiry} events={events} history={history} />);
    const tab = screen.getByRole("tab", { name: /계정 이력/ });
    expect(tab).toHaveTextContent("1");
    await userEvent.click(tab);
    expect(screen.getByRole("link", { name: /예전 문의/ })).toHaveAttribute("href", "/games/game-1/inquiries/inq-0");
    expect(screen.queryByText("접수 정보")).not.toBeInTheDocument();
  });
});
```

`StatusSelect`/`PrioritySelect`의 `<select>`가 `aria-label` 없이 `<label>` 텍스트("상태", "우선순위")로 감싸져 있는지 확인한다 (`components/inquiries/StatusSelect.tsx`의 return 부분). `getByLabelText("상태")`가 못 찾으면 그 컴포넌트의 실제 라벨 문구에 맞춘다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/InboxDetailPanel.test.tsx`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`components/inbox/InboxDetailPanel.tsx`:

```tsx
"use client";

import { useState, type ReactNode } from "react";
import type { InquiryRow } from "@/lib/inquiries";
import type { EventRow } from "@/lib/events";
import type { AccountHistoryEntry } from "@/lib/account-history";
import { describeEvent } from "@/lib/events";
import { emailLocalPart, formatReceivedAt, inquiryMetaRows } from "@/lib/format";
import StatusSelect from "@/components/inquiries/StatusSelect";
import PrioritySelect from "@/components/inquiries/PrioritySelect";
import AccountHistoryPanel from "@/components/inquiries/AccountHistoryPanel";

type Tab = "detail" | "history";

const DOT: Record<EventRow["kind"], string> = {
  status_changed: "bg-ink",
  priority_changed: "bg-amber-600",
  reply_sent: "bg-ink",
  note_added: "bg-amber-600",
};

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-xs font-semibold text-muted">{children}</h2>;
}

/** 오른쪽 상세 패널. 처리 컨트롤·접수 정보·처리 기록과 계정 이력을 탭으로. */
export default function InboxDetailPanel({
  inquiry,
  events,
  history,
}: {
  inquiry: InquiryRow;
  events: EventRow[];
  history: AccountHistoryEntry[];
}) {
  const [tab, setTab] = useState<Tab>("detail");
  const rows = inquiryMetaRows(inquiry);

  const tabClass = (active: boolean) =>
    `h-8 px-3 inline-flex items-center gap-1.5 text-[13px] border-b-2 transition-colors ${
      active ? "border-ink text-ink font-semibold" : "border-transparent text-muted hover:text-ink"
    }`;

  return (
    <aside className="w-[300px] shrink-0 h-full bg-panel flex flex-col overflow-hidden" aria-label="문의 상세">
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

      <div className="flex-1 overflow-y-auto">
        {tab === "detail" ? (
          <>
            <section className="px-4 py-3.5 border-b border-line flex flex-col gap-2.5">
              <SectionTitle>처리</SectionTitle>
              <StatusSelect inquiryId={inquiry.id} currentStatus={inquiry.status} />
              <PrioritySelect inquiryId={inquiry.id} currentPriority={inquiry.priority} />
            </section>

            <section className="px-4 py-3.5 border-b border-line flex flex-col gap-2">
              <SectionTitle>접수 정보</SectionTitle>
              <dl className="flex flex-col gap-1.5 text-[13px]">
                {rows.map((row) => (
                  <div key={row.key} className="flex items-start justify-between gap-3">
                    <dt className="text-muted shrink-0">{row.label}</dt>
                    <dd className="text-right break-all">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="px-4 py-3.5 flex flex-col gap-2">
              <SectionTitle>처리 기록</SectionTitle>
              <ol className="flex flex-col gap-2 text-xs">
                {events.map((event) => (
                  <li key={event.id} className="flex items-start gap-2.5">
                    <span className={`w-1.5 h-1.5 rounded-full mt-[5px] shrink-0 ${DOT[event.kind]}`} aria-hidden="true" />
                    <span className="flex-1">
                      {describeEvent(event)} <span className="text-muted" title={event.actorEmail}>· {emailLocalPart(event.actorEmail)}</span>
                    </span>
                    <span className="text-muted font-mono text-[11px] shrink-0">{formatReceivedAt(event.createdAt)}</span>
                  </li>
                ))}
                {/* 접수 이벤트는 저장하지 않는다. created_at이 같은 정보를 갖고 있다. */}
                <li className="flex items-start gap-2.5">
                  <span className="w-1.5 h-1.5 rounded-full mt-[5px] shrink-0 bg-accent" aria-hidden="true" />
                  <span className="flex-1">접수</span>
                  <span className="text-muted font-mono text-[11px] shrink-0">{formatReceivedAt(inquiry.createdAt)}</span>
                </li>
              </ol>
            </section>
          </>
        ) : (
          <div className="px-4 py-3.5">
            <AccountHistoryPanel history={history} gameAccount={inquiry.gameAccount} currentTypeKey={inquiry.typeKey} gameId={inquiry.gameId} frameless />
          </div>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/components/InboxDetailPanel.test.tsx && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add components/inbox/InboxDetailPanel.tsx tests/components/InboxDetailPanel.test.tsx
git commit -m "feat: inbox detail panel with processing, meta, log, and history tabs"
```

---

### Task 12: `InboxPrevNext`, `InboxConversation`, `InboxEmptyState`, `InboxShell`

**Files:**
- Create: `components/inbox/InboxPrevNext.tsx`, `components/inbox/InboxConversation.tsx`, `components/inbox/InboxEmptyState.tsx`, `components/inbox/InboxShell.tsx`
- Test: `tests/components/InboxPrevNext.test.tsx`, `tests/components/InboxConversation.test.tsx`

**Interfaces:**
- Consumes: 앞선 Task의 모든 컴포넌트와 `buildTimeline`, `ResolveButton`, `SyncRepliesButton`, `formatElapsed`, `formatReceivedAt`.
- Produces:
  ```tsx
  <InboxPrevNext gameId inquiryId query ids />
  <InboxConversation gameId inquiry labels query siblingIds entries templates />
  <InboxEmptyState />
  <InboxShell game query labels counts listPage selected />   // selected: InboxSelection | null
  interface InboxSelection {
    inquiry: InquiryRow; attachments: AttachmentWithUrl[]; history: AccountHistoryEntry[];
    notes: NoteRow[]; events: EventRow[]; templates: TemplateRow[]; messages: MessageRow[]; siblingIds: string[];
  }
  ```

- [ ] **Step 1: 테스트 작성**

`tests/components/InboxPrevNext.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import InboxPrevNext from "@/components/inbox/InboxPrevNext";
import { DEFAULT_QUERY } from "@/lib/inquiry-filters";

describe("InboxPrevNext", () => {
  it("links to the previous and next inquiries on the same query", () => {
    render(<InboxPrevNext gameId="g1" inquiryId="b" query={{ ...DEFAULT_QUERY, sort: "oldest" }} ids={["a", "b", "c"]} />);
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "이전 문의" })).toHaveAttribute("href", "/games/g1/inquiries/a?sort=oldest");
    expect(screen.getByRole("link", { name: "다음 문의" })).toHaveAttribute("href", "/games/g1/inquiries/c?sort=oldest");
  });

  it("disables the edges", () => {
    render(<InboxPrevNext gameId="g1" inquiryId="a" query={DEFAULT_QUERY} ids={["a", "b"]} />);
    expect(screen.queryByRole("link", { name: "이전 문의" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "다음 문의" })).toHaveAttribute("href", "/games/g1/inquiries/b");
  });

  it("renders nothing when the inquiry is not in the list or the list is a single item", () => {
    const { container, rerender } = render(<InboxPrevNext gameId="g1" inquiryId="zzz" query={DEFAULT_QUERY} ids={["a", "b"]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<InboxPrevNext gameId="g1" inquiryId="a" query={DEFAULT_QUERY} ids={["a"]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

`tests/components/InboxConversation.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import InboxConversation from "@/components/inbox/InboxConversation";
import type { InquiryRow } from "@/lib/inquiries";
import type { TimelineEntry } from "@/lib/timeline";
import { DEFAULT_QUERY } from "@/lib/inquiry-filters";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/inbox/ReplyComposer", () => ({ default: () => <div data-testid="composer" /> }));

const inquiry: InquiryRow = {
  id: "inq-1",
  inquiryNo: "R-20260903-0007",
  gameId: "g1",
  groupKey: "game_usage",
  typeKey: "payment_refund",
  gameAccount: "luna_park",
  companyName: null,
  replyEmail: "luna@example.com",
  title: "중복 결제 환불 요청드립니다",
  content: "본문",
  status: "in_progress",
  priority: "high",
  meta: {},
  draftReply: null,
  replyContent: null,
  repliedAt: null,
  gmailThreadId: null,
  createdAt: new Date().toISOString(),
};

const labels = { groupLabels: { game_usage: "게임 이용 문의" }, typeLabels: { payment_refund: "결제/환불" }, typeOrder: ["payment_refund"] };
const entries: TimelineEntry[] = [{ kind: "inquiry", id: "inq-1", at: inquiry.createdAt, author: "luna_park", body: "본문", attachments: [] }];

function renderIt(overrides: Partial<InquiryRow> = {}) {
  return render(
    <InboxConversation gameId="g1" inquiry={{ ...inquiry, ...overrides }} labels={labels} query={DEFAULT_QUERY} siblingIds={["x", "inq-1", "y"]} entries={entries} templates={[]} />
  );
}

describe("InboxConversation", () => {
  it("renders the header with number, title, badge, category, and prev/next", () => {
    renderIt();
    expect(screen.getByText("R-20260903-0007")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "중복 결제 환불 요청드립니다" })).toBeInTheDocument();
    expect(screen.getByText("처리중")).toBeInTheDocument();
    expect(screen.getByText("게임 이용 문의 · 결제/환불")).toBeInTheDocument();
    expect(screen.getByText(/접수 .* · 경과 0분/)).toBeInTheDocument();
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "완료로 표시" })).toBeInTheDocument();
    expect(screen.getByTestId("composer")).toBeInTheDocument();
  });

  it("shows 회신 확인 only when there is a Gmail thread", () => {
    renderIt();
    expect(screen.queryByRole("button", { name: /회신 확인/ })).not.toBeInTheDocument();
    renderIt({ gmailThreadId: "t1" });
    expect(screen.getByRole("button", { name: /회신 확인/ })).toBeInTheDocument();
  });
});
```

`SyncRepliesButton`의 버튼 문구가 "회신 확인"을 포함하는지 확인한다 (`grep -n "회신" components/inquiries/SyncRepliesButton.tsx`). 다르면 정규식을 맞춘다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/InboxPrevNext.test.tsx tests/components/InboxConversation.test.tsx`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: `InboxPrevNext` 구현**

`components/inbox/InboxPrevNext.tsx`:

```tsx
import Link from "next/link";
import { inquiryHref, type InquiryListQuery } from "@/lib/inquiry-filters";

const BTN = "w-7 h-[26px] inline-flex items-center justify-center rounded-md text-muted hover:bg-ground hover:text-ink transition-colors";
const BTN_OFF = "w-7 h-[26px] inline-flex items-center justify-center rounded-md text-muted opacity-40";

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={dir === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}

/** 같은 목록 조건 안에서 이전/다음 문의. ids는 listInquiryIds가 같은 조건·정렬로 뽑은 전체 id다. */
export default function InboxPrevNext({
  gameId,
  inquiryId,
  query,
  ids,
}: {
  gameId: string;
  inquiryId: string;
  query: InquiryListQuery;
  ids: string[];
}) {
  const index = ids.indexOf(inquiryId);
  if (index < 0 || ids.length < 2) return null;

  const prevId = index > 0 ? ids[index - 1] : null;
  const nextId = index < ids.length - 1 ? ids[index + 1] : null;

  return (
    <nav className="flex items-center gap-0.5 border border-line rounded-lg p-0.5" aria-label="문의 이동">
      {prevId ? (
        <Link href={inquiryHref(gameId, prevId, query)} className={BTN} aria-label="이전 문의" rel="prev">
          <Chevron dir="left" />
        </Link>
      ) : (
        <span className={BTN_OFF} aria-disabled="true">
          <Chevron dir="left" />
        </span>
      )}
      <span className="font-mono text-[11px] text-muted px-1">
        {index + 1} / {ids.length}
      </span>
      {nextId ? (
        <Link href={inquiryHref(gameId, nextId, query)} className={BTN} aria-label="다음 문의" rel="next">
          <Chevron dir="right" />
        </Link>
      ) : (
        <span className={BTN_OFF} aria-disabled="true">
          <Chevron dir="right" />
        </span>
      )}
    </nav>
  );
}
```

- [ ] **Step 4: `InboxConversation`, `InboxEmptyState` 구현**

`components/inbox/InboxConversation.tsx`:

```tsx
import type { InquiryRow } from "@/lib/inquiries";
import type { CategoryLabelMaps } from "@/lib/categories";
import type { TemplateRow } from "@/lib/templates";
import type { TimelineEntry } from "@/lib/timeline";
import type { InquiryListQuery } from "@/lib/inquiry-filters";
import { formatElapsed, formatReceivedAt } from "@/lib/format";
import StatusBadge from "@/components/ui/StatusBadge";
import ResolveButton from "@/components/inquiries/ResolveButton";
import SyncRepliesButton from "@/components/inquiries/SyncRepliesButton";
import InboxPrevNext from "@/components/inbox/InboxPrevNext";
import InboxTimeline from "@/components/inbox/InboxTimeline";
import ReplyComposer from "@/components/inbox/ReplyComposer";

/** 가운데 열: 헤더(제목·상태·이동·완료) / 타임라인 / 작성란. */
export default function InboxConversation({
  gameId,
  inquiry,
  labels,
  query,
  siblingIds,
  entries,
  templates,
}: {
  gameId: string;
  inquiry: InquiryRow;
  labels: CategoryLabelMaps;
  query: InquiryListQuery;
  siblingIds: string[];
  entries: TimelineEntry[];
  templates: TemplateRow[];
}) {
  return (
    <section className="flex-1 min-w-0 h-full bg-panel border-r border-line flex flex-col overflow-hidden" aria-label="대화">
      <header className="flex items-center justify-between gap-4 h-16 px-5 border-b border-line shrink-0">
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-baseline gap-2.5 min-w-0">
            <span className="font-mono text-[13px] text-muted shrink-0">{inquiry.inquiryNo ?? "—"}</span>
            <h1 className="text-base font-bold truncate">{inquiry.title}</h1>
          </div>
          <div className="flex items-center gap-2.5 text-xs text-muted">
            <StatusBadge status={inquiry.status} />
            <span>
              {labels.groupLabels[inquiry.groupKey] ?? inquiry.groupKey} · {labels.typeLabels[inquiry.typeKey] ?? inquiry.typeKey}
            </span>
            <span>
              접수 {formatReceivedAt(inquiry.createdAt)} · 경과 {formatElapsed(inquiry.createdAt)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <InboxPrevNext gameId={gameId} inquiryId={inquiry.id} query={query} ids={siblingIds} />
          {inquiry.gmailThreadId && <SyncRepliesButton inquiryId={inquiry.id} />}
          <ResolveButton inquiryId={inquiry.id} currentStatus={inquiry.status} />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto bg-ground px-6 py-5">
        <InboxTimeline entries={entries} />
      </div>

      <ReplyComposer
        inquiryId={inquiry.id}
        replyEmail={inquiry.replyEmail}
        initialDraft={inquiry.draftReply}
        templates={templates}
        typeKey={inquiry.typeKey}
      />
    </section>
  );
}
```

`components/inbox/InboxEmptyState.tsx`:

```tsx
/** 문의를 고르지 않았을 때 대화·상세 자리에 그리는 빈 상태. */
export default function InboxEmptyState() {
  return (
    <section className="flex-1 min-w-0 h-full bg-ground flex items-center justify-center" aria-label="대화">
      <div className="text-center">
        <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-panel border border-line flex items-center justify-center text-muted">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 4h16v12H8l-4 4z" />
          </svg>
        </div>
        <p className="text-sm text-muted">목록에서 문의를 선택하세요</p>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: `InboxShell` 구현**

`components/inbox/InboxShell.tsx`:

```tsx
import type { GameRow, CategoryLabelMaps } from "@/lib/categories";
import type { AttachmentWithUrl, InquiryFacetCounts, InquiryPage, InquiryRow } from "@/lib/inquiries";
import type { AccountHistoryEntry } from "@/lib/account-history";
import type { NoteRow } from "@/lib/notes";
import type { EventRow } from "@/lib/events";
import type { TemplateRow } from "@/lib/templates";
import type { MessageRow } from "@/lib/messages";
import type { InquiryListQuery } from "@/lib/inquiry-filters";
import { buildTimeline } from "@/lib/timeline";
import InboxNav from "@/components/inbox/InboxNav";
import InboxList from "@/components/inbox/InboxList";
import InboxConversation from "@/components/inbox/InboxConversation";
import InboxDetailPanel from "@/components/inbox/InboxDetailPanel";
import InboxEmptyState from "@/components/inbox/InboxEmptyState";

export interface InboxSelection {
  inquiry: InquiryRow;
  attachments: AttachmentWithUrl[];
  history: AccountHistoryEntry[];
  notes: NoteRow[];
  events: EventRow[];
  templates: TemplateRow[];
  messages: MessageRow[];
  siblingIds: string[];
}

/** 목록 머리에 보여줄 현재 보기 이름. */
export function describeView(query: InquiryListQuery): string {
  if (query.stale) return "3일 이상 미처리";
  switch (query.status) {
    case "new":
      return "접수";
    case "in_progress":
      return "처리중";
    case "resolved":
      return "완료";
    default:
      return "전체";
  }
}

/** 4단 배치. 게임 레일은 관리자 layout이 그리므로 여기에는 보기·목록·대화·상세만 있다. */
export default function InboxShell({
  game,
  query,
  labels,
  counts,
  listPage,
  selected,
}: {
  game: GameRow;
  query: InquiryListQuery;
  labels: CategoryLabelMaps;
  counts: InquiryFacetCounts | null;
  listPage: InquiryPage;
  selected: InboxSelection | null;
}) {
  const selectedId = selected?.inquiry.id ?? null;

  return (
    <div className="flex h-screen min-w-[1180px] flex-1">
      <InboxNav game={game} query={query} labels={labels} counts={counts} selectedId={selectedId} />
      <InboxList gameId={game.id} page={listPage} query={query} labels={labels} selectedId={selectedId} viewLabel={describeView(query)} />
      {selected ? (
        <>
          <InboxConversation
            gameId={game.id}
            inquiry={selected.inquiry}
            labels={labels}
            query={query}
            siblingIds={selected.siblingIds}
            entries={buildTimeline(selected.inquiry, selected.attachments, selected.messages, selected.notes)}
            templates={selected.templates}
          />
          <InboxDetailPanel inquiry={selected.inquiry} events={selected.events} history={selected.history} />
        </>
      ) : (
        <InboxEmptyState />
      )}
    </div>
  );
}
```

- [ ] **Step 6: 통과 확인**

Run: `npx vitest run tests/components/InboxPrevNext.test.tsx tests/components/InboxConversation.test.tsx && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add components/inbox tests/components/InboxPrevNext.test.tsx tests/components/InboxConversation.test.tsx
git commit -m "feat: conversation column, empty state, and inbox shell"
```

---

### Task 13: 인박스 페이지와 layout 전환

**Files:**
- Create: `app/(admin)/games/[gameId]/inquiries/[[...inquiryId]]/page.tsx`
- Delete: `app/(admin)/games/[gameId]/inquiries/page.tsx`
- Modify: `app/(admin)/layout.tsx`, `app/(admin)/games/page.tsx`, `app/(admin)/games/[gameId]/templates/page.tsx`

**Interfaces:**
- Consumes: `InboxShell`, `InboxSelection` (Task 12), `getInquiryFacetCounts` (Task 3), `listInquiryIds(options)` (Task 2).

- [ ] **Step 1: 옛 목록 페이지 삭제**

```bash
git rm "app/(admin)/games/[gameId]/inquiries/page.tsx"
```

(같은 디렉터리에 `page.tsx`와 `[[...inquiryId]]/page.tsx`가 함께 있으면 Next가 같은 경로를 두 번 정의했다고 빌드를 거부한다.)

- [ ] **Step 2: 페이지 작성**

`app/(admin)/games/[gameId]/inquiries/[[...inquiryId]]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import {
  getInquiryById,
  getInquiryFacetCounts,
  listAttachmentSignedUrls,
  listInquiryIds,
  queryInquiries,
} from "@/lib/inquiries";
import { parseInquiryListQuery } from "@/lib/inquiry-filters";
import { listCategoryLabels, listGames } from "@/lib/categories";
import { getAccountHistory } from "@/lib/account-history";
import { listNotes } from "@/lib/notes";
import { listEvents } from "@/lib/events";
import { listTemplates } from "@/lib/templates";
import { listMessages } from "@/lib/messages";
import InboxShell, { type InboxSelection } from "@/components/inbox/InboxShell";

export const dynamic = "force-dynamic";

/**
 * 인박스 한 화면. /games/{g}/inquiries 는 목록만, /games/{g}/inquiries/{id} 는
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
  const inquiryId = params.inquiryId?.[0] ?? null;

  const supabase = getSupabaseServerClient();
  const query = parseInquiryListQuery(searchParams);

  const [games, labels, counts, listPage] = await Promise.all([
    listGames(supabase),
    listCategoryLabels(supabase, params.gameId),
    getInquiryFacetCounts(supabase, params.gameId),
    queryInquiries(supabase, params.gameId, query),
  ]);

  const game = games.find((entry) => entry.id === params.gameId);
  if (!game) {
    notFound();
  }

  let selected: InboxSelection | null = null;
  if (inquiryId) {
    const inquiry = await getInquiryById(supabase, inquiryId);
    if (!inquiry || inquiry.gameId !== params.gameId) {
      notFound();
    }
    const [attachments, history, notes, events, templates, messages, siblingIds] = await Promise.all([
      listAttachmentSignedUrls(supabase, inquiry.id),
      getAccountHistory(supabase, inquiry.gameId, inquiry.gameAccount, inquiry.id),
      listNotes(supabase, inquiry.id),
      listEvents(supabase, inquiry.id),
      listTemplates(supabase, inquiry.gameId),
      listMessages(supabase, inquiry.id),
      listInquiryIds(supabase, inquiry.gameId, query),
    ]);
    selected = { inquiry, attachments, history, notes, events, templates, messages, siblingIds };
  }

  return <InboxShell game={game} query={query} labels={labels} counts={counts} listPage={listPage} selected={selected} />;
}
```

- [ ] **Step 3: layout과 나머지 두 페이지**

`app/(admin)/layout.tsx`의 `<main>`을:

```tsx
      <main className="flex-1 min-w-0 h-screen overflow-hidden flex">{children}</main>
```

`app/(admin)/games/page.tsx`: 빈 상태 루트 `<div className="h-full min-h-[70vh] flex items-center justify-center">`를 `<div className="flex-1 overflow-y-auto px-8 py-6 flex items-center justify-center">`로.

`app/(admin)/games/[gameId]/templates/page.tsx`: 루트 `<div className="flex flex-col gap-4">`를 `<div className="flex-1 overflow-y-auto px-8 py-6 flex flex-col gap-4">`로.

- [ ] **Step 4: 타입·테스트·빌드 확인**

Run: `npx tsc --noEmit && npm test`
Expected: PASS (옛 상세 페이지 `app/(admin)/inquiries/[id]/page.tsx`는 아직 `inquiryDetailHref` 등을 쓰므로 그대로 컴파일된다).

Run: `npm run build`
Expected: 성공. `.env`가 없어 실패하면 `SUPABASE_URL=http://localhost SUPABASE_SERVICE_ROLE_KEY=x NEXT_PUBLIC_SUPABASE_URL=http://localhost NEXT_PUBLIC_SUPABASE_ANON_KEY=x npm run build`로 다시 시도한다 (모든 페이지가 `force-dynamic`이라 빌드 중 DB에 접근하지 않는다). 라우트 충돌 오류가 나오면 Step 1이 안 된 것이다.

- [ ] **Step 5: 브라우저 확인**

`npm run dev`로 띄워 `/games/{게임 id}/inquiries`를 연다. 확인 항목:
- 4단이 한 화면에 나오고 페이지 전체 스크롤이 없다 (창을 1180px보다 좁히면 가로 스크롤).
- 왼쪽 보기 링크를 누르면 목록이 바뀌고 건수가 맞는다.
- 목록 행을 누르면 URL이 `/games/{g}/inquiries/{id}?…`로 바뀌고 대화·상세가 뜬다. 새로고침해도 같다.
- 답변 발송 / 내부 메모 추가 / 상태·우선순위 변경 후 목록 배지와 타임라인이 갱신된다.

문제가 있으면 여기서 고친다. Supabase에 0008 마이그레이션을 적용하지 않았으면 보기 건수가 비어 나온다 — 그것이 의도한 fallback이다. 적용은 `supabase db push` 또는 대시보드 SQL 편집기에서 파일 내용을 실행한다.

- [ ] **Step 6: 커밋**

```bash
git add "app/(admin)" 
git commit -m "feat: replace list and detail pages with the inbox page"
```

---

### Task 14: 레거시 리다이렉트와 Slack 링크

**Files:**
- Modify: `app/(admin)/inquiries/[id]/page.tsx` (전체 교체), `app/api/notify/inquiry/route.ts`
- Test: `tests/api/notify-inquiry.test.ts`

**Interfaces:**
- Consumes: `legacyInquiryRedirectHref` (Task 1).

- [ ] **Step 1: Slack 링크 테스트 수정**

`tests/api/notify-inquiry.test.ts`의 기대를 바꾼다. 테스트 상단 `record`의 `game_id` 값을 확인하고 (예: `"game-1"`):

```ts
    expect(JSON.stringify(message.blocks)).toContain("https://admin.theplayplus.com/games/game-1/inquiries/inq-1");
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/api/notify-inquiry.test.ts`
Expected: FAIL — 아직 `/inquiries/inq-1`.

- [ ] **Step 3: 구현**

`app/api/notify/inquiry/route.ts`:

```ts
    detailUrl: `${new URL(request.url).origin}/games/${record.game_id}/inquiries/${record.id}`,
```

`app/(admin)/inquiries/[id]/page.tsx` 전체를 다음으로 교체:

```tsx
import { notFound, redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { getInquiryById } from "@/lib/inquiries";
import { legacyInquiryRedirectHref } from "@/lib/inquiry-filters";

export const dynamic = "force-dynamic";

/**
 * 예전 상세 URL. 이미 나간 Slack 메시지의 링크가 여기를 가리키므로
 * 인박스 URL로 보내기만 한다. 새 링크는 만들지 않는다.
 */
export default async function LegacyInquiryPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { list?: string | string[] };
}) {
  const supabase = getSupabaseServerClient();
  const inquiry = await getInquiryById(supabase, params.id);
  if (!inquiry) {
    notFound();
  }
  const listParam = Array.isArray(searchParams.list) ? searchParams.list[0] : searchParams.list;
  redirect(legacyInquiryRedirectHref(inquiry.gameId, inquiry.id, listParam));
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/api/notify-inquiry.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add "app/(admin)/inquiries/[id]/page.tsx" app/api/notify/inquiry/route.ts tests/api/notify-inquiry.test.ts
git commit -m "feat: redirect legacy inquiry URLs and link Slack to the inbox"
```

---

### Task 15: 옛 컴포넌트 삭제와 문서 갱신

**Files:**
- Delete: `components/inquiries/{InquiryMailbox,InquiryNav,InquiryDetail,InquiryThread,InquiryNotes,InquiryHeader,InquiryMetaCard,InquiryEventLog}.tsx`와 `tests/components/{InquiryMailbox,InquiryNav,InquiryDetail,InquiryThread,InquiryNotes,InquiryHeader,InquiryMetaCard,InquiryEventLog}.test.tsx`
- Modify: `lib/inquiry-filters.ts` (`inquiryDetailHref` 제거), `tests/lib/inquiry-filters.test.ts`, `CLAUDE.md`

- [ ] **Step 1: 삭제**

```bash
for n in InquiryMailbox InquiryNav InquiryDetail InquiryThread InquiryNotes InquiryHeader InquiryMetaCard InquiryEventLog; do
  git rm "components/inquiries/$n.tsx" "tests/components/$n.test.tsx"
done
```

- [ ] **Step 2: `inquiryDetailHref` 제거**

`lib/inquiry-filters.ts`에서 `inquiryDetailHref` 함수와 주석을 지운다. `tests/lib/inquiry-filters.test.ts`에서 import와 그것을 쓰는 `describe("hrefs")` 안의 케이스를 지운다.

```bash
grep -rn "inquiryDetailHref\|InquiryMailbox\|InquiryNav\|InquiryDetail\b\|InquiryThread\|InquiryNotes\|InquiryHeader\|InquiryMetaCard\|InquiryEventLog" app components lib tests
```

Expected: 출력 없음.

- [ ] **Step 3: `CLAUDE.md` 갱신**

"핵심 기능" 2번을 다음으로 교체:

```
2. **인박스 화면** — `/games/{gameId}/inquiries[/{inquiryId}]` 한 페이지가 4단(게임 레일 · 문의함 보기 · 문의 목록 · 대화+답변 · 상세 패널)을 서버 렌더한다. 필터(상태/유형/우선순위/3일 이상 미처리)·정렬·검색·페이지는 URL 쿼리로 관리하고 DB에서 처리하며, 문의를 골라도 같은 쿼리가 URL에 남는다. 보기 건수는 `inquiry_facet_counts` RPC(마이그레이션 0008) 한 번으로 가져오고 실패하면 건수 없이 그린다. 체크박스로 여러 건 상태 일괄 변경. 게임 레일에 접수(new) 건수 배지. 예전 `/inquiries/{id}` 링크는 새 URL로 리다이렉트된다.
```

5번을 다음으로 교체:

```
5. **대화·이동** — 대화 열은 문의 본문(첨부 포함)·보낸 답변·사용자 회신·내부 메모를 시간순 한 줄기로 보여주고(`lib/timeline.ts`), 작성란은 답변/내부 메모 탭. 헤더의 이전/다음은 목록과 같은 조건·정렬 안에서 움직인다.
```

3번 문장 중 "문의 상세에서"는 "대화 열에서"로, 4번의 "문의 상세에서 … 보여주고"는 "상세 패널의 계정 이력 탭에서 … 보여주고"로 바꾼다. 상세 설계 링크 줄에 `docs/superpowers/specs/2026-09-03-inbox-layout-design.md`를 추가한다.

- [ ] **Step 4: 전체 확인**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add -A components/inquiries tests/components lib/inquiry-filters.ts tests/lib/inquiry-filters.test.ts CLAUDE.md
git commit -m "chore: remove pre-inbox inquiry components and update docs"
```

---

## 배포 메모 (계획 밖, 실행자가 사용자에게 전달)

- Supabase에 `0008_inquiry_facet_counts.sql`을 적용해야 보기 건수가 나온다. 적용 전에도 화면은 동작한다.
- Slack 알림 링크 형식이 바뀌었다. Supabase Webhook 설정은 바꿀 필요 없다.
