# 문의 상세 개편 2단계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 문의 상세에 내부 메모, 변경 이력(감사 로그), 답변 초안 저장을 추가한다.

**Architecture:** 이번 단계에서 처음으로 "누가 했는가"가 필요해진다. `requireAdminSession()`이 사용자를 조회하고도 버리던 것을 `getAdminSession()`으로 넓혀 행위자를 얻고, 그 이메일을 `inquiry_notes` / `inquiry_events`에 비정규화해 저장한다. 이력 적재는 실패해도 핵심 동작(상태 변경·답변 발송)을 막지 않는다 — `recordEvent()`가 실패를 스스로 삼킨다. 참고 화면의 "접수" 이력 줄은 저장하지 않고 `inquiries.created_at`으로 화면에서 합성한다.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS, Supabase (Postgres + service-role 클라이언트), zod, Vitest + React Testing Library

**Spec:** `docs/superpowers/specs/2026-09-02-inquiry-detail-phase2-design.md`

## Global Constraints

- 관리자 UI는 **한국어 전용**.
- 이벤트 `kind` 값은 `status_changed` / `priority_changed` / `reply_sent` / `note_added` 넷뿐이다. 초안 저장은 이벤트를 남기지 않는다.
- **이력 적재 실패가 핵심 동작을 막아서는 안 된다** (CLAUDE.md 규칙). `recordEvent()`는 절대 throw하지 않고 `console.warn`만 남긴다. 이벤트 적재 실패 시에도 API는 `{ success: true }`.
- `inquiry_notes` / `inquiry_events` 모두 RLS를 켜고 **정책을 두지 않는다**. 이 테이블들에 쓰는 트리거가 없으므로 1단계와 달리 `security definer` 함수는 필요 없다.
- 행위자 이메일은 비정규화해 저장한다. `auth.users`를 조인하지 않고, `author_id`/`actor_id`에 FK 제약을 걸지 않는다.
- 카드 스타일은 `bg-panel border border-line rounded-2xl p-4`. 색상은 토큰(`ink`, `muted`, `line`, `panel`, `ground`, `accent`)만 쓴다.
- 마이그레이션은 재실행 가능해야 한다 (`if not exists`).
- 테스트 실행은 `npx vitest run <path>`, 전체는 `npm test`.
- 담당자 배정, 보상 패널, 메모 수정·삭제, LLM 답변 추천은 **범위 밖**이다. 만들지 마라.

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `supabase/migrations/0003_inquiry_notes_and_events.sql` | `draft_reply` 컬럼, `inquiry_notes`·`inquiry_events` 테이블, RLS, 인덱스 | 생성 |
| `lib/require-admin-session.ts` | `getAdminSession()` 추가, `requireAdminSession()`은 래퍼로 | 수정 |
| `lib/format.ts` | `emailLocalPart()` 추가 | 수정 |
| `lib/notes.ts` | 메모 조회·생성 | 생성 |
| `lib/events.ts` | 이벤트 조회·적재·문구 생성 | 생성 |
| `lib/inquiries.ts` | `InquiryRow`에 `draftReply` 추가 | 수정 |
| `app/api/inquiries/[id]/notes/route.ts` | 메모 추가 POST | 생성 |
| `app/api/inquiries/[id]/draft/route.ts` | 초안 저장 PUT | 생성 |
| `app/api/inquiries/[id]/status/route.ts` | `status_changed` 이벤트 | 수정 |
| `app/api/inquiries/[id]/priority/route.ts` | `priority_changed` 이벤트 | 수정 |
| `app/api/inquiries/[id]/reply/route.ts` | `reply_sent` 이벤트, 초안 비우기 | 수정 |
| `components/inquiries/InquiryNotes.tsx` | 내부 메모 카드 | 생성 |
| `components/inquiries/InquiryEventLog.tsx` | 변경 이력 카드 | 생성 |
| `components/inquiries/ReplyForm.tsx` | 초안 저장 버튼, 프리필 | 수정 |
| `app/(admin)/inquiries/[id]/page.tsx` | 메모·이력 조회와 배치 | 수정 |

**Task 순서 의존성:** Task 1(마이그레이션) → Task 2(`getAdminSession`) → Task 3(`emailLocalPart`) → Task 4(`lib/events.ts`) → Task 5(`lib/notes.ts`) → Task 6~8(API) → Task 9~11(컴포넌트·페이지).

---

### Task 1: 마이그레이션 — 메모·이력 테이블과 초안 컬럼

**Files:**
- Create: `supabase/migrations/0003_inquiry_notes_and_events.sql`

**Interfaces:**
- Consumes: `0001`의 `inquiries` 테이블
- Produces: `inquiries.draft_reply` (text), `inquiry_notes` 테이블, `inquiry_events` 테이블

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- 내부 메모(inquiry_notes), 변경 이력(inquiry_events), 답변 초안(draft_reply).
--
-- 1단계의 inquiry_number_seq와 달리 이 테이블들에는 트리거가 붙지 않는다.
-- 관리자 앱의 service-role 클라이언트만 읽고 쓰므로 security definer 함수도
-- 필요 없다. RLS를 켜고 정책을 두지 않으면 anon/authenticated는 전면 차단된다.

alter table inquiries add column if not exists draft_reply text;

create table if not exists inquiry_notes (
  id           uuid primary key default gen_random_uuid(),
  inquiry_id   uuid not null references inquiries(id) on delete cascade,
  author_id    uuid,
  author_email text not null,
  content      text not null,
  created_at   timestamptz not null default now()
);

-- actor_id/author_id에 FK를 걸지 않는 이유: 감사 기록은 계정이 삭제된 뒤에도
-- 누가 처리했는지가 남아야 한다. 이메일을 비정규화해 저장하는 이유도 같다.
create table if not exists inquiry_events (
  id           uuid primary key default gen_random_uuid(),
  inquiry_id   uuid not null references inquiries(id) on delete cascade,
  actor_id     uuid,
  actor_email  text not null,
  kind         text not null,
  from_value   text,
  to_value     text,
  created_at   timestamptz not null default now()
);

create index if not exists inquiry_notes_inquiry_id_idx  on inquiry_notes (inquiry_id, created_at);
create index if not exists inquiry_events_inquiry_id_idx on inquiry_events (inquiry_id, created_at);

alter table inquiry_notes  enable row level security;
alter table inquiry_events enable row level security;
```

- [ ] **Step 2: 로컬 Postgres에서 재실행 가능성 확인**

트리거가 없어 1단계만큼의 검증은 필요 없지만, 재실행 가능성만 확인한다.

```bash
export PATH=/opt/homebrew/opt/postgresql@16/bin:$PATH
PGD=<scratchpad>/pgdata2; SOCK=/private/tmp/pp2sock
rm -rf "$PGD" "$SOCK"; mkdir -p "$PGD" "$SOCK"
initdb -D "$PGD" -U postgres --auth=trust >/dev/null 2>&1
pg_ctl -D "$PGD" -o "-p 55433 -k $SOCK -c listen_addresses=''" -l "$PGD/log" start
export PGHOST="$SOCK" PGPORT=55433 PGUSER=postgres
psql -v ON_ERROR_STOP=1 -c 'create extension if not exists "pgcrypto";'
psql -v ON_ERROR_STOP=1 -c 'create table inquiries (id uuid primary key default gen_random_uuid());'
psql -v ON_ERROR_STOP=1 -f supabase/migrations/0003_inquiry_notes_and_events.sql; echo "1회차 exit=$?"
psql -v ON_ERROR_STOP=1 -f supabase/migrations/0003_inquiry_notes_and_events.sql; echo "2회차 exit=$?"
pg_ctl -D "$PGD" stop -m immediate; rm -rf "$PGD" "$SOCK"
```

Expected: 두 회차 모두 `exit=0`

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/0003_inquiry_notes_and_events.sql
git commit -m "feat: add inquiry notes, event log, and draft reply migration"
```

---

### Task 2: `getAdminSession()` — 행위자 신원

**Files:**
- Modify: `lib/require-admin-session.ts`
- Test: `tests/lib/require-admin-session.test.ts`

**Interfaces:**
- Consumes: `@supabase/ssr`의 `createServerClient`, `next/headers`의 `cookies`
- Produces:
  - `interface AdminSession { id: string; email: string }`
  - `getAdminSession(): Promise<AdminSession | null>`
  - `requireAdminSession(): Promise<boolean>` (기존 시그니처 유지)

- [ ] **Step 1: 실패하는 테스트 추가**

`tests/lib/require-admin-session.test.ts`의 기존 `describe` 블록은 그대로 두고, 파일 끝에 다음을 추가한다:

```ts
describe("getAdminSession", () => {
  beforeEach(() => {
    createServerClientMock.mockClear();
    getUserMock.mockReset();
    cookiesGetMock.mockReset();
  });

  it("returns the id and email of the authenticated user", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1", email: "info@theplayplus.com" } } });
    const { getAdminSession } = await import("@/lib/require-admin-session");

    await expect(getAdminSession()).resolves.toEqual({ id: "user-1", email: "info@theplayplus.com" });
  });

  it("returns null when there is no user", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const { getAdminSession } = await import("@/lib/require-admin-session");

    await expect(getAdminSession()).resolves.toBeNull();
  });

  it("falls back to the user id when the account has no email", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    const { getAdminSession } = await import("@/lib/require-admin-session");

    await expect(getAdminSession()).resolves.toEqual({ id: "user-1", email: "user-1" });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/lib/require-admin-session.test.ts`
Expected: FAIL — `getAdminSession is not a function`

- [ ] **Step 3: 구현**

`lib/require-admin-session.ts` 전체를 교체한다:

```ts
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export interface AdminSession {
  id: string;
  email: string;
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set() {},
        remove() {},
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  // 이메일 없는 계정은 이론적으로 가능하다. 이력에 빈 문자열이 남는 것보다
  // id라도 남기는 편이 낫다.
  return { id: user.id, email: user.email ?? user.id };
}

export async function requireAdminSession(): Promise<boolean> {
  return (await getAdminSession()) !== null;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/lib/require-admin-session.test.ts`
Expected: PASS (기존 2개 + 신규 3개)

- [ ] **Step 5: 커밋**

```bash
git add lib/require-admin-session.ts tests/lib/require-admin-session.test.ts
git commit -m "feat: expose the admin actor via getAdminSession"
```

---

### Task 3: `emailLocalPart()`

**Files:**
- Modify: `lib/format.ts`
- Test: `tests/lib/format.test.ts`

**Interfaces:**
- Produces: `emailLocalPart(email: string): string`

- [ ] **Step 1: 실패하는 테스트 추가**

`tests/lib/format.test.ts`의 import에 `emailLocalPart`를 추가하고, 파일 끝에 다음 describe를 붙인다:

```ts
describe("emailLocalPart", () => {
  it("takes the part before the @", () => {
    expect(emailLocalPart("info@theplayplus.com")).toBe("info");
  });

  it("returns the input unchanged when there is no @", () => {
    expect(emailLocalPart("user-1")).toBe("user-1");
  });

  it("returns an empty string for empty input", () => {
    expect(emailLocalPart("")).toBe("");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/lib/format.test.ts`
Expected: FAIL — `emailLocalPart is not a function`

- [ ] **Step 3: 구현**

`lib/format.ts` 끝에 추가한다:

```ts
/** 이력·메모의 행위자 표시용. info@theplayplus.com → info */
export function emailLocalPart(email: string): string {
  const at = email.indexOf("@");
  return at === -1 ? email : email.slice(0, at);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/lib/format.test.ts`
Expected: PASS (기존 11개 + 신규 3개)

- [ ] **Step 5: 커밋**

```bash
git add lib/format.ts tests/lib/format.test.ts
git commit -m "feat: add emailLocalPart formatter for actor display"
```

---

### Task 4: `lib/events.ts` — 이벤트 조회·적재·문구

**Files:**
- Create: `lib/events.ts`
- Test: `tests/lib/events.test.ts`

**Interfaces:**
- Consumes: `SupabaseClient` from `@supabase/supabase-js`
- Produces:
  - `type EventKind = "status_changed" | "priority_changed" | "reply_sent" | "note_added"`
  - `interface EventRow { id: string; actorEmail: string; kind: EventKind; fromValue: string | null; toValue: string | null; createdAt: string }`
  - `listEvents(supabase, inquiryId): Promise<EventRow[]>` — 최신순
  - `recordEvent(supabase, input): Promise<void>` — **절대 throw하지 않는다**
  - `describeEvent(event: Pick<EventRow, "kind" | "fromValue" | "toValue">): string`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/lib/events.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { listEvents, recordEvent, describeEvent } from "@/lib/events";

const sampleRow = {
  id: "evt-1",
  actor_email: "info@theplayplus.com",
  kind: "status_changed",
  from_value: "new",
  to_value: "resolved",
  created_at: "2026-09-02T04:00:00.000Z",
};

describe("describeEvent", () => {
  it("describes a status change with Korean labels", () => {
    expect(describeEvent({ kind: "status_changed", fromValue: "new", toValue: "resolved" })).toBe(
      "상태 접수 → 완료"
    );
  });

  it("describes a priority change with Korean labels", () => {
    expect(describeEvent({ kind: "priority_changed", fromValue: "normal", toValue: "urgent" })).toBe(
      "우선순위 보통 → 긴급"
    );
  });

  it("describes reply and note events without values", () => {
    expect(describeEvent({ kind: "reply_sent", fromValue: null, toValue: null })).toBe("답변 발송");
    expect(describeEvent({ kind: "note_added", fromValue: null, toValue: null })).toBe("메모 추가");
  });

  it("falls back to the raw value when a code has no Korean label", () => {
    expect(describeEvent({ kind: "status_changed", fromValue: null, toValue: "bogus" })).toBe(
      "상태 — → bogus"
    );
  });
});

describe("listEvents", () => {
  it("filters by inquiry_id and orders newest first", async () => {
    const order = vi.fn().mockResolvedValue({ data: [sampleRow], error: null });
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));

    const result = await listEvents({ from } as never, "inq-1");

    expect(from).toHaveBeenCalledWith("inquiry_events");
    expect(eq).toHaveBeenCalledWith("inquiry_id", "inq-1");
    expect(order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(result).toEqual([
      {
        id: "evt-1",
        actorEmail: "info@theplayplus.com",
        kind: "status_changed",
        fromValue: "new",
        toValue: "resolved",
        createdAt: "2026-09-02T04:00:00.000Z",
      },
    ]);
  });

  it("returns an empty array when the query errors", async () => {
    const order = vi.fn().mockResolvedValue({ data: null, error: { message: "db error" } });
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));

    await expect(listEvents({ from } as never, "inq-1")).resolves.toEqual([]);
  });
});

describe("recordEvent", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("inserts the event row", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn(() => ({ insert }));

    await recordEvent({ from } as never, {
      inquiryId: "inq-1",
      actor: { id: "user-1", email: "info@theplayplus.com" },
      kind: "status_changed",
      fromValue: "new",
      toValue: "resolved",
    });

    expect(from).toHaveBeenCalledWith("inquiry_events");
    expect(insert).toHaveBeenCalledWith({
      inquiry_id: "inq-1",
      actor_id: "user-1",
      actor_email: "info@theplayplus.com",
      kind: "status_changed",
      from_value: "new",
      to_value: "resolved",
    });
  });

  it("defaults from_value and to_value to null when omitted", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn(() => ({ insert }));

    await recordEvent({ from } as never, {
      inquiryId: "inq-1",
      actor: { id: "user-1", email: "a@b.com" },
      kind: "reply_sent",
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ from_value: null, to_value: null })
    );
  });

  it("swallows an insert error instead of throwing", async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: "db error" } });
    const from = vi.fn(() => ({ insert }));

    await expect(
      recordEvent({ from } as never, {
        inquiryId: "inq-1",
        actor: { id: "user-1", email: "a@b.com" },
        kind: "reply_sent",
      })
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("swallows a thrown error instead of propagating it", async () => {
    const from = vi.fn(() => {
      throw new Error("boom");
    });

    await expect(
      recordEvent({ from } as never, {
        inquiryId: "inq-1",
        actor: { id: "user-1", email: "a@b.com" },
        kind: "reply_sent",
      })
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/lib/events.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/events"`

- [ ] **Step 3: 구현**

`lib/events.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminSession } from "@/lib/require-admin-session";

export type EventKind = "status_changed" | "priority_changed" | "reply_sent" | "note_added";

export interface EventRow {
  id: string;
  actorEmail: string;
  kind: EventKind;
  fromValue: string | null;
  toValue: string | null;
  createdAt: string;
}

export interface RecordEventInput {
  inquiryId: string;
  actor: AdminSession;
  kind: EventKind;
  fromValue?: string | null;
  toValue?: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  new: "접수",
  in_progress: "처리중",
  resolved: "완료",
};

const PRIORITY_LABELS: Record<string, string> = {
  urgent: "긴급",
  high: "높음",
  normal: "보통",
  low: "낮음",
};

function label(labels: Record<string, string>, value: string | null): string {
  if (!value) {
    return "—";
  }
  return labels[value] ?? value;
}

/** 이력 한 줄의 한국어 문구. 컴포넌트가 아니라 여기서 만들어야 테스트할 수 있다. */
export function describeEvent(event: Pick<EventRow, "kind" | "fromValue" | "toValue">): string {
  switch (event.kind) {
    case "status_changed":
      return `상태 ${label(STATUS_LABELS, event.fromValue)} → ${label(STATUS_LABELS, event.toValue)}`;
    case "priority_changed":
      return `우선순위 ${label(PRIORITY_LABELS, event.fromValue)} → ${label(PRIORITY_LABELS, event.toValue)}`;
    case "reply_sent":
      return "답변 발송";
    case "note_added":
      return "메모 추가";
  }
}

export async function listEvents(supabase: SupabaseClient, inquiryId: string): Promise<EventRow[]> {
  const { data, error } = await supabase
    .from("inquiry_events")
    .select("id, actor_email, kind, from_value, to_value, created_at")
    .eq("inquiry_id", inquiryId)
    .order("created_at", { ascending: false });

  if (error || !data) {
    return [];
  }

  return data.map((row) => ({
    id: row.id,
    actorEmail: row.actor_email,
    kind: row.kind as EventKind,
    fromValue: row.from_value,
    toValue: row.to_value,
    createdAt: row.created_at,
  }));
}

/**
 * 이력 적재는 부가 작업이다. 실패해도 상태 변경이나 답변 발송을 되돌리지
 * 않는다 (CLAUDE.md 규칙). 호출부마다 try/catch를 반복하면 한 군데를
 * 빠뜨리기 쉬우므로 여기서 삼킨다.
 */
export async function recordEvent(supabase: SupabaseClient, input: RecordEventInput): Promise<void> {
  try {
    const { error } = await supabase.from("inquiry_events").insert({
      inquiry_id: input.inquiryId,
      actor_id: input.actor.id,
      actor_email: input.actor.email,
      kind: input.kind,
      from_value: input.fromValue ?? null,
      to_value: input.toValue ?? null,
    });
    if (error) {
      console.warn("[events] failed to record event", { kind: input.kind, message: error.message });
    }
  } catch (error) {
    console.warn("[events] failed to record event", { kind: input.kind, error });
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/lib/events.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/events.ts tests/lib/events.test.ts
git commit -m "feat: add inquiry event log with non-blocking recording"
```

---

### Task 5: `lib/notes.ts`

**Files:**
- Create: `lib/notes.ts`
- Test: `tests/lib/notes.test.ts`

**Interfaces:**
- Consumes: `AdminSession` (Task 2)
- Produces:
  - `interface NoteRow { id: string; authorEmail: string; content: string; createdAt: string }`
  - `listNotes(supabase, inquiryId): Promise<NoteRow[]>` — 오래된 순
  - `createNote(supabase, input: { inquiryId: string; author: AdminSession; content: string }): Promise<boolean>` — 성공 여부

메모는 이벤트와 달리 **실패를 삼키지 않는다.** 사용자가 방금 쓴 글이 사라지면 안 되므로 API가 500을 돌려주고 화면이 에러를 띄워야 한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/lib/notes.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { listNotes, createNote } from "@/lib/notes";

const sampleRow = {
  id: "note-1",
  author_email: "info@theplayplus.com",
  content: "결제 로그 확인함",
  created_at: "2026-09-02T04:00:00.000Z",
};

describe("listNotes", () => {
  it("filters by inquiry_id and orders oldest first", async () => {
    const order = vi.fn().mockResolvedValue({ data: [sampleRow], error: null });
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));

    const result = await listNotes({ from } as never, "inq-1");

    expect(from).toHaveBeenCalledWith("inquiry_notes");
    expect(eq).toHaveBeenCalledWith("inquiry_id", "inq-1");
    expect(order).toHaveBeenCalledWith("created_at", { ascending: true });
    expect(result).toEqual([
      {
        id: "note-1",
        authorEmail: "info@theplayplus.com",
        content: "결제 로그 확인함",
        createdAt: "2026-09-02T04:00:00.000Z",
      },
    ]);
  });

  it("returns an empty array when the query errors", async () => {
    const order = vi.fn().mockResolvedValue({ data: null, error: { message: "db error" } });
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));

    await expect(listNotes({ from } as never, "inq-1")).resolves.toEqual([]);
  });
});

describe("createNote", () => {
  it("inserts the note and reports success", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn(() => ({ insert }));

    const ok = await createNote({ from } as never, {
      inquiryId: "inq-1",
      author: { id: "user-1", email: "info@theplayplus.com" },
      content: "결제 로그 확인함",
    });

    expect(insert).toHaveBeenCalledWith({
      inquiry_id: "inq-1",
      author_id: "user-1",
      author_email: "info@theplayplus.com",
      content: "결제 로그 확인함",
    });
    expect(ok).toBe(true);
  });

  it("reports failure instead of throwing when the insert errors", async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: "db error" } });
    const from = vi.fn(() => ({ insert }));

    const ok = await createNote({ from } as never, {
      inquiryId: "inq-1",
      author: { id: "user-1", email: "a@b.com" },
      content: "x",
    });

    expect(ok).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/lib/notes.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/notes"`

- [ ] **Step 3: 구현**

`lib/notes.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminSession } from "@/lib/require-admin-session";

export interface NoteRow {
  id: string;
  authorEmail: string;
  content: string;
  createdAt: string;
}

export interface CreateNoteInput {
  inquiryId: string;
  author: AdminSession;
  content: string;
}

export async function listNotes(supabase: SupabaseClient, inquiryId: string): Promise<NoteRow[]> {
  const { data, error } = await supabase
    .from("inquiry_notes")
    .select("id, author_email, content, created_at")
    .eq("inquiry_id", inquiryId)
    .order("created_at", { ascending: true });

  if (error || !data) {
    return [];
  }

  return data.map((row) => ({
    id: row.id,
    authorEmail: row.author_email,
    content: row.content,
    createdAt: row.created_at,
  }));
}

/**
 * 이벤트 적재와 달리 실패를 삼키지 않는다. 방금 작성한 메모가 조용히
 * 사라지면 안 되므로 호출부가 사용자에게 알릴 수 있게 성공 여부를 돌려준다.
 */
export async function createNote(supabase: SupabaseClient, input: CreateNoteInput): Promise<boolean> {
  const { error } = await supabase.from("inquiry_notes").insert({
    inquiry_id: input.inquiryId,
    author_id: input.author.id,
    author_email: input.author.email,
    content: input.content,
  });
  return !error;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/lib/notes.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/notes.ts tests/lib/notes.test.ts
git commit -m "feat: add inquiry internal notes data access"
```

---

### Task 6: 기존 status / priority 라우트에 이벤트 적재

**Files:**
- Modify: `app/api/inquiries/[id]/status/route.ts`
- Modify: `app/api/inquiries/[id]/priority/route.ts`
- Test: `tests/api/inquiry-status.test.ts`, `tests/api/inquiry-priority.test.ts`

**Interfaces:**
- Consumes: `getAdminSession()` (Task 2), `recordEvent()` (Task 4)
- Produces: 변경 없음 (응답 형태 동일)

두 라우트는 지금 변경 전 값을 읽지 않는다. `from_value`를 남기려면 update 전에 select가 한 번 더 필요하다.

- [ ] **Step 1: status 테스트 수정**

`tests/api/inquiry-status.test.ts`의 mock 선언부에 `@/lib/events`를 추가한다:

```ts
import * as eventsModule from "@/lib/events";

vi.mock("@/lib/events", () => ({
  recordEvent: vi.fn(),
}));
```

그리고 `@/lib/require-admin-session` mock을 `getAdminSession`도 갖도록 바꾼다:

```ts
vi.mock("@/lib/require-admin-session", () => ({
  requireAdminSession: vi.fn(),
  getAdminSession: vi.fn(),
}));
```

`beforeEach`를 다음으로 교체한다:

```ts
  beforeEach(() => {
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReset();
    vi.mocked(eventsModule.recordEvent).mockReset().mockResolvedValue(undefined);
    vi.mocked(requireAdminSessionModule.getAdminSession)
      .mockReset()
      .mockResolvedValue({ id: "user-1", email: "info@theplayplus.com" });
  });
```

401 테스트의 첫 줄을 `vi.mocked(requireAdminSessionModule.getAdminSession).mockResolvedValue(null);`로 바꾼다.

기존 "updates the status and returns success" 테스트의 supabase mock을 select도 갖도록 바꾸고 이벤트 단언을 추가한다:

```ts
  function mockStatusClient(currentStatus: string | null, updateError: { message: string } | null = null) {
    const single = vi.fn().mockResolvedValue({
      data: currentStatus === null ? null : { status: currentStatus },
      error: null,
    });
    const eqSelect = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq: eqSelect }));
    const eqUpdate = vi.fn().mockResolvedValue({ error: updateError });
    const update = vi.fn(() => ({ eq: eqUpdate }));
    const from = vi.fn(() => ({ select, update }));
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({ from } as never);
    return { update, eqUpdate };
  }

  it("updates the status and records an event with the previous value", async () => {
    const { update, eqUpdate } = mockStatusClient("new");

    const request = new Request("http://localhost/api/inquiries/inq-1/status", {
      method: "PATCH",
      body: JSON.stringify({ status: "in_progress" }),
    });
    const response = await PATCH(request, { params: { id: "inq-1" } });
    const json = await response.json();

    expect(update).toHaveBeenCalledWith({ status: "in_progress" });
    expect(eqUpdate).toHaveBeenCalledWith("id", "inq-1");
    expect(eventsModule.recordEvent).toHaveBeenCalledWith(expect.anything(), {
      inquiryId: "inq-1",
      actor: { id: "user-1", email: "info@theplayplus.com" },
      kind: "status_changed",
      fromValue: "new",
      toValue: "in_progress",
    });
    expect(json).toEqual({ success: true });
  });

  it("still returns success when recording the event fails", async () => {
    mockStatusClient("new");
    vi.mocked(eventsModule.recordEvent).mockRejectedValue(new Error("boom"));

    const request = new Request("http://localhost/api/inquiries/inq-1/status", {
      method: "PATCH",
      body: JSON.stringify({ status: "resolved" }),
    });
    const response = await PATCH(request, { params: { id: "inq-1" } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it("does not record an event when the update fails", async () => {
    mockStatusClient("new", { message: "db error" });

    const request = new Request("http://localhost/api/inquiries/inq-1/status", {
      method: "PATCH",
      body: JSON.stringify({ status: "resolved" }),
    });
    const response = await PATCH(request, { params: { id: "inq-1" } });

    expect(response.status).toBe(500);
    expect(eventsModule.recordEvent).not.toHaveBeenCalled();
  });
```

기존의 "updates the status and returns success"와 "returns 500 when the update fails" 두 테스트는 위 세 개로 대체한다 (같은 것을 두 번 검증하지 않는다).

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/api/inquiry-status.test.ts`
Expected: FAIL — `getAdminSession` 미정의 / `recordEvent` 미호출

- [ ] **Step 3: status 라우트 구현**

`app/api/inquiries/[id]/status/route.ts` 전체를 교체한다:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase";
import { getAdminSession } from "@/lib/require-admin-session";
import { recordEvent } from "@/lib/events";

const statusSchema = z.object({ status: z.enum(["new", "in_progress", "resolved"]) });

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const actor = await getAdminSession();
  if (!actor) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = statusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_status" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();

  // 이력에 "무엇에서 무엇으로"를 남기려면 변경 전 값이 필요하다.
  const { data: before } = await supabase
    .from("inquiries")
    .select("status")
    .eq("id", params.id)
    .single();

  const { error } = await supabase.from("inquiries").update({ status: parsed.data.status }).eq("id", params.id);

  if (error) {
    return NextResponse.json({ success: false, error: "update_failed" }, { status: 500 });
  }

  // 이력 적재는 부가 작업이다. 실패해도 상태 변경을 되돌리지 않는다.
  await recordEvent(supabase, {
    inquiryId: params.id,
    actor,
    kind: "status_changed",
    fromValue: before?.status ?? null,
    toValue: parsed.data.status,
  }).catch(() => {});

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: status 통과 확인**

Run: `npx vitest run tests/api/inquiry-status.test.ts`
Expected: PASS

- [ ] **Step 5: priority 테스트를 같은 방식으로 수정**

`tests/api/inquiry-priority.test.ts`에 위와 같은 mock 추가(`@/lib/events`, `getAdminSession`), `beforeEach` 교체, 401 테스트 수정을 적용한다. 그리고 기존 "updates the priority and returns success" / "returns 500 when the update fails" 두 테스트를 다음 세 개로 대체한다:

```ts
  function mockPriorityClient(currentPriority: string | null, updateError: { message: string } | null = null) {
    const single = vi.fn().mockResolvedValue({
      data: currentPriority === null ? null : { priority: currentPriority },
      error: null,
    });
    const eqSelect = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq: eqSelect }));
    const eqUpdate = vi.fn().mockResolvedValue({ error: updateError });
    const update = vi.fn(() => ({ eq: eqUpdate }));
    const from = vi.fn(() => ({ select, update }));
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({ from } as never);
    return { from, update, eqUpdate };
  }

  it("updates the priority and records an event with the previous value", async () => {
    const { from, update, eqUpdate } = mockPriorityClient("normal");

    const response = await PATCH(patchRequest({ priority: "urgent" }), { params: { id: "inq-1" } });
    const json = await response.json();

    expect(from).toHaveBeenCalledWith("inquiries");
    expect(update).toHaveBeenCalledWith({ priority: "urgent" });
    expect(eqUpdate).toHaveBeenCalledWith("id", "inq-1");
    expect(eventsModule.recordEvent).toHaveBeenCalledWith(expect.anything(), {
      inquiryId: "inq-1",
      actor: { id: "user-1", email: "info@theplayplus.com" },
      kind: "priority_changed",
      fromValue: "normal",
      toValue: "urgent",
    });
    expect(json).toEqual({ success: true });
  });

  it("still returns success when recording the event fails", async () => {
    mockPriorityClient("normal");
    vi.mocked(eventsModule.recordEvent).mockRejectedValue(new Error("boom"));

    const response = await PATCH(patchRequest({ priority: "high" }), { params: { id: "inq-1" } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it("does not record an event when the update fails", async () => {
    mockPriorityClient("normal", { message: "db error" });

    const response = await PATCH(patchRequest({ priority: "low" }), { params: { id: "inq-1" } });

    expect(response.status).toBe(500);
    expect(eventsModule.recordEvent).not.toHaveBeenCalled();
  });
```

- [ ] **Step 6: priority 라우트 구현**

`app/api/inquiries/[id]/priority/route.ts`를 status 라우트와 같은 구조로 바꾼다 — `getAdminSession()`, 변경 전 `priority` select, update, `recordEvent(..., kind: "priority_changed")`.

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase";
import { getAdminSession } from "@/lib/require-admin-session";
import { recordEvent } from "@/lib/events";

const prioritySchema = z.object({ priority: z.enum(["urgent", "high", "normal", "low"]) });

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const actor = await getAdminSession();
  if (!actor) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = prioritySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_priority" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();

  const { data: before } = await supabase
    .from("inquiries")
    .select("priority")
    .eq("id", params.id)
    .single();

  const { error } = await supabase.from("inquiries").update({ priority: parsed.data.priority }).eq("id", params.id);

  if (error) {
    return NextResponse.json({ success: false, error: "update_failed" }, { status: 500 });
  }

  await recordEvent(supabase, {
    inquiryId: params.id,
    actor,
    kind: "priority_changed",
    fromValue: before?.priority ?? null,
    toValue: parsed.data.priority,
  }).catch(() => {});

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 7: 통과 확인과 커밋**

Run: `npx vitest run tests/api/inquiry-status.test.ts tests/api/inquiry-priority.test.ts`
Expected: PASS

```bash
git add "app/api/inquiries/[id]/status/route.ts" "app/api/inquiries/[id]/priority/route.ts" tests/api/inquiry-status.test.ts tests/api/inquiry-priority.test.ts
git commit -m "feat: record status and priority changes in the event log"
```

---

### Task 7: 메모 추가 API

**Files:**
- Create: `app/api/inquiries/[id]/notes/route.ts`
- Test: `tests/api/inquiry-notes.test.ts`

**Interfaces:**
- Consumes: `getAdminSession()` (Task 2), `createNote()` (Task 5), `recordEvent()` (Task 4)
- Produces: `POST(request, ctx): Promise<NextResponse>` — `{ success: true }` 또는 `{ success: false, error: "unauthorized" | "invalid_note" | "save_failed" }`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/api/inquiry-notes.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/inquiries/[id]/notes/route";
import * as supabaseModule from "@/lib/supabase";
import * as notesModule from "@/lib/notes";
import * as eventsModule from "@/lib/events";
import * as sessionModule from "@/lib/require-admin-session";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/notes", () => ({ createNote: vi.fn() }));
vi.mock("@/lib/events", () => ({ recordEvent: vi.fn() }));
vi.mock("@/lib/require-admin-session", () => ({ getAdminSession: vi.fn() }));

function postRequest(body: unknown) {
  return new Request("http://localhost/api/inquiries/inq-1/notes", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const actor = { id: "user-1", email: "info@theplayplus.com" };

describe("POST /api/inquiries/[id]/notes", () => {
  beforeEach(() => {
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReset().mockReturnValue({} as never);
    vi.mocked(notesModule.createNote).mockReset().mockResolvedValue(true);
    vi.mocked(eventsModule.recordEvent).mockReset().mockResolvedValue(undefined);
    vi.mocked(sessionModule.getAdminSession).mockReset().mockResolvedValue(actor);
  });

  it("returns 401 when there is no admin session", async () => {
    vi.mocked(sessionModule.getAdminSession).mockResolvedValue(null);

    const response = await POST(postRequest({ content: "메모" }), { params: { id: "inq-1" } });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ success: false, error: "unauthorized" });
    expect(notesModule.createNote).not.toHaveBeenCalled();
  });

  it("rejects an empty note", async () => {
    const response = await POST(postRequest({ content: "   " }), { params: { id: "inq-1" } });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ success: false, error: "invalid_note" });
    expect(notesModule.createNote).not.toHaveBeenCalled();
  });

  it("creates the note and records a note_added event", async () => {
    const response = await POST(postRequest({ content: "  결제 로그 확인함  " }), { params: { id: "inq-1" } });

    expect(notesModule.createNote).toHaveBeenCalledWith(expect.anything(), {
      inquiryId: "inq-1",
      author: actor,
      content: "결제 로그 확인함",
    });
    expect(eventsModule.recordEvent).toHaveBeenCalledWith(expect.anything(), {
      inquiryId: "inq-1",
      actor,
      kind: "note_added",
    });
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it("returns 500 when the note could not be saved", async () => {
    vi.mocked(notesModule.createNote).mockResolvedValue(false);

    const response = await POST(postRequest({ content: "메모" }), { params: { id: "inq-1" } });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ success: false, error: "save_failed" });
    expect(eventsModule.recordEvent).not.toHaveBeenCalled();
  });

  it("still returns success when recording the event fails", async () => {
    vi.mocked(eventsModule.recordEvent).mockRejectedValue(new Error("boom"));

    const response = await POST(postRequest({ content: "메모" }), { params: { id: "inq-1" } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/api/inquiry-notes.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/inquiries/[id]/notes/route"`

- [ ] **Step 3: 구현**

`app/api/inquiries/[id]/notes/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase";
import { getAdminSession } from "@/lib/require-admin-session";
import { createNote } from "@/lib/notes";
import { recordEvent } from "@/lib/events";

const noteSchema = z.object({ content: z.string().trim().min(1).max(5000) });

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const actor = await getAdminSession();
  if (!actor) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = noteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_note" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();

  // 메모는 이벤트와 달리 실패를 삼키지 않는다. 방금 쓴 글이 조용히 사라지면 안 된다.
  const saved = await createNote(supabase, {
    inquiryId: params.id,
    author: actor,
    content: parsed.data.content,
  });

  if (!saved) {
    return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
  }

  await recordEvent(supabase, { inquiryId: params.id, actor, kind: "note_added" }).catch(() => {});

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/api/inquiry-notes.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add "app/api/inquiries/[id]/notes/route.ts" tests/api/inquiry-notes.test.ts
git commit -m "feat: add internal note creation API route"
```

---

### Task 8: 초안 저장 API와 답변 발송 연동

**Files:**
- Create: `app/api/inquiries/[id]/draft/route.ts`
- Modify: `app/api/inquiries/[id]/reply/route.ts`
- Modify: `lib/inquiries.ts`
- Test: `tests/api/inquiry-draft.test.ts`, `tests/api/inquiry-reply.test.ts`, `tests/lib/inquiries.test.ts`

**Interfaces:**
- Consumes: `getAdminSession()` (Task 2), `recordEvent()` (Task 4)
- Produces:
  - `PUT /api/inquiries/[id]/draft` — `{ success: true }` / `error: "unauthorized" | "invalid_draft" | "save_failed"`
  - `InquiryRow.draftReply: string | null`

- [ ] **Step 1: 초안 라우트 테스트 작성**

`tests/api/inquiry-draft.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PUT } from "@/app/api/inquiries/[id]/draft/route";
import * as supabaseModule from "@/lib/supabase";
import * as sessionModule from "@/lib/require-admin-session";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/require-admin-session", () => ({ getAdminSession: vi.fn() }));

function putRequest(body: unknown) {
  return new Request("http://localhost/api/inquiries/inq-1/draft", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

function mockClient(updateError: { message: string } | null = null) {
  const eq = vi.fn().mockResolvedValue({ error: updateError });
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({ from } as never);
  return { update, eq };
}

describe("PUT /api/inquiries/[id]/draft", () => {
  beforeEach(() => {
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReset();
    vi.mocked(sessionModule.getAdminSession)
      .mockReset()
      .mockResolvedValue({ id: "user-1", email: "info@theplayplus.com" });
  });

  it("returns 401 when there is no admin session", async () => {
    vi.mocked(sessionModule.getAdminSession).mockResolvedValue(null);

    const response = await PUT(putRequest({ draftReply: "초안" }), { params: { id: "inq-1" } });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ success: false, error: "unauthorized" });
  });

  it("saves the draft", async () => {
    const { update, eq } = mockClient();

    const response = await PUT(putRequest({ draftReply: "작성 중인 답변" }), { params: { id: "inq-1" } });

    expect(update).toHaveBeenCalledWith({ draft_reply: "작성 중인 답변" });
    expect(eq).toHaveBeenCalledWith("id", "inq-1");
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it("clears the draft when given an empty string", async () => {
    const { update } = mockClient();

    await PUT(putRequest({ draftReply: "" }), { params: { id: "inq-1" } });

    expect(update).toHaveBeenCalledWith({ draft_reply: null });
  });

  it("rejects a non-string draft", async () => {
    const response = await PUT(putRequest({ draftReply: 42 }), { params: { id: "inq-1" } });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ success: false, error: "invalid_draft" });
  });

  it("returns 500 when the update fails", async () => {
    mockClient({ message: "db error" });

    const response = await PUT(putRequest({ draftReply: "초안" }), { params: { id: "inq-1" } });

    expect(response.status).toBe(500);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/api/inquiry-draft.test.ts`
Expected: FAIL — 모듈 미해결

- [ ] **Step 3: 초안 라우트 구현**

`app/api/inquiries/[id]/draft/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase";
import { getAdminSession } from "@/lib/require-admin-session";

const draftSchema = z.object({ draftReply: z.string().max(5000) });

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const actor = await getAdminSession();
  if (!actor) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = draftSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_draft" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  // 빈 문자열은 "초안 없음"으로 저장한다. 빈 문자열이 남으면 프리필이
  // 애매해진다.
  const { error } = await supabase
    .from("inquiries")
    .update({ draft_reply: parsed.data.draftReply === "" ? null : parsed.data.draftReply })
    .eq("id", params.id);

  if (error) {
    return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
  }

  // 초안 저장은 자주 눌리는 동작이라 이력을 남기지 않는다 (스펙 결정 4).
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/api/inquiry-draft.test.ts`
Expected: PASS

- [ ] **Step 5: `InquiryRow`에 `draftReply` 추가**

`tests/lib/inquiries.test.ts`의 `sampleRow`에 `draft_reply: "작성 중"`을 추가하고, 기존 "maps inquiry_no, priority, and meta" 테스트에 다음을 덧붙인다:

```ts
    expect(result?.draftReply).toBe("작성 중");
```

`lib/inquiries.ts`에서:
- `InquiryRow`에 `draftReply: string | null;`을 `replyContent` 앞에 추가
- `mapInquiryRow`의 파라미터 타입에 `draft_reply: string | null;` 추가
- 반환 객체에 `draftReply: row.draft_reply ?? null,` 추가

`tests/components/InquiryDetail.test.tsx`, `tests/components/InquiryMailbox.test.tsx`, `tests/components/InquiryHeader.test.tsx`, `tests/components/InquiryMetaCard.test.tsx`의 `InquiryRow` 픽스처에 `draftReply: null,`을 추가한다.

- [ ] **Step 6: reply 라우트 — 이벤트와 초안 비우기**

`tests/api/inquiry-reply.test.ts`에 `@/lib/events` mock과 `getAdminSession` mock을 추가한다:

```ts
import * as eventsModule from "@/lib/events";

vi.mock("@/lib/events", () => ({ recordEvent: vi.fn() }));

vi.mock("@/lib/require-admin-session", () => ({
  requireAdminSession: vi.fn(),
  getAdminSession: vi.fn(),
}));
```

`beforeEach`에 다음을 추가한다:

```ts
    vi.mocked(eventsModule.recordEvent).mockReset().mockResolvedValue(undefined);
    vi.mocked(requireAdminSessionModule.getAdminSession)
      .mockReset()
      .mockResolvedValue({ id: "user-1", email: "info@theplayplus.com" });
```

401 테스트의 첫 줄을 `vi.mocked(requireAdminSessionModule.getAdminSession).mockResolvedValue(null);`로 바꾼다.

성공 테스트의 update 단언을 다음으로 바꾸고 이벤트 단언을 추가한다:

```ts
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "resolved",
        reply_content: "답변 내용입니다",
        draft_reply: null,
      })
    );
    expect(eventsModule.recordEvent).toHaveBeenCalledWith(expect.anything(), {
      inquiryId: "inq-1",
      actor: { id: "user-1", email: "info@theplayplus.com" },
      kind: "reply_sent",
    });
```

그리고 다음 테스트를 추가한다:

```ts
  it("still returns success when recording the event fails", async () => {
    mockFetchInquiry({ id: "inq-1", reply_email: "user@example.com", title: "제목", inquiry_no: "R-1" });
    vi.mocked(gmailModule.sendReplyEmail).mockResolvedValue(undefined);
    vi.mocked(eventsModule.recordEvent).mockRejectedValue(new Error("boom"));

    const response = await POST(jsonRequest({ replyContent: "답변" }), { params: { id: "inq-1" } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
  });
```

`app/api/inquiries/[id]/reply/route.ts`에서:
- `requireAdminSession` import를 `getAdminSession`으로 바꾸고, 가드를 `const actor = await getAdminSession(); if (!actor) { ... }`로 교체
- update 객체에 `draft_reply: null` 추가 (발송했으니 초안은 비운다)
- `updateError` 처리 뒤, `return NextResponse.json({ success: true })` 앞에 다음을 넣는다:

```ts
  await recordEvent(supabase, { inquiryId: params.id, actor, kind: "reply_sent" }).catch(() => {});
```

- [ ] **Step 7: 전체 검증과 커밋**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 타입 에러 없음, 모든 테스트 PASS

```bash
git add "app/api/inquiries/[id]/draft/route.ts" "app/api/inquiries/[id]/reply/route.ts" lib/inquiries.ts tests/api/inquiry-draft.test.ts tests/api/inquiry-reply.test.ts tests/lib/inquiries.test.ts tests/components
git commit -m "feat: add reply draft storage and log reply_sent events"
```

---

### Task 9: `InquiryNotes` 컴포넌트

**Files:**
- Create: `components/inquiries/InquiryNotes.tsx`
- Test: `tests/components/InquiryNotes.test.tsx`

**Interfaces:**
- Consumes: `NoteRow` (Task 5), `emailLocalPart` · `formatReceivedAt` (Task 3 / 1단계), `POST /api/inquiries/[id]/notes` (Task 7)
- Produces: `<InquiryNotes inquiryId={string} notes={NoteRow[]} />`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/components/InquiryNotes.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InquiryNotes from "@/components/inquiries/InquiryNotes";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

const notes = [
  {
    id: "note-1",
    authorEmail: "info@theplayplus.com",
    content: "결제 로그 확인함",
    createdAt: "2026-09-02T04:00:00.000Z",
  },
];

describe("InquiryNotes", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true }) }) as never;
  });

  it("shows an empty state when there are no notes", () => {
    render(<InquiryNotes inquiryId="inq-1" notes={[]} />);
    expect(screen.getByText("등록된 메모가 없습니다.")).toBeInTheDocument();
  });

  it("says the notes are staff-only", () => {
    render(<InquiryNotes inquiryId="inq-1" notes={[]} />);
    expect(screen.getByText(/운영자 전용/)).toBeInTheDocument();
  });

  it("renders a note with the author id part", () => {
    render(<InquiryNotes inquiryId="inq-1" notes={notes} />);
    expect(screen.getByText("결제 로그 확인함")).toBeInTheDocument();
    // 전체 이메일은 title 속성으로만 남기고 화면에는 아이디 부분만 찍는다.
    // 정규식 매칭은 span과 부모 p 양쪽에 걸려 "multiple elements"가 되므로
    // title로 정확히 집는다.
    expect(screen.getByTitle("info@theplayplus.com")).toHaveTextContent(/^info$/);
    expect(screen.queryByText(/theplayplus\.com/)).not.toBeInTheDocument();
  });

  it("posts the note and refreshes", async () => {
    render(<InquiryNotes inquiryId="inq-1" notes={[]} />);

    await userEvent.type(screen.getByLabelText("내부 메모"), "환불 처리함");
    await userEvent.click(screen.getByRole("button", { name: "메모 추가" }));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/inquiries/inq-1/notes",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ content: "환불 처리함" }) })
    );
    expect(refreshMock).toHaveBeenCalled();
  });

  it("keeps the text and shows an error when saving fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: false }) }) as never;
    render(<InquiryNotes inquiryId="inq-1" notes={[]} />);

    await userEvent.type(screen.getByLabelText("내부 메모"), "환불 처리함");
    await userEvent.click(screen.getByRole("button", { name: "메모 추가" }));

    expect(await screen.findByText("메모 저장에 실패했습니다.")).toBeInTheDocument();
    expect(screen.getByLabelText("내부 메모")).toHaveValue("환불 처리함");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("does not submit an empty note", async () => {
    render(<InquiryNotes inquiryId="inq-1" notes={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "메모 추가" }));
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/InquiryNotes.test.tsx`
Expected: FAIL — 모듈 미해결

- [ ] **Step 3: 구현**

`components/inquiries/InquiryNotes.tsx`:

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { NoteRow } from "@/lib/notes";
import { emailLocalPart, formatReceivedAt } from "@/lib/format";

export default function InquiryNotes({ inquiryId, notes }: { inquiryId: string; notes: NoteRow[] }) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = content.trim();
    if (trimmed === "") {
      return;
    }

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
    <section className="bg-panel border border-line rounded-2xl p-4">
      <h2 className="font-semibold mb-3">
        내부 메모 <span className="text-sm font-normal text-muted">운영자 전용 · 사용자에게 보이지 않음</span>
      </h2>

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <label className="flex flex-col gap-1">
          <span className="sr-only">내부 메모</span>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
            placeholder="처리 과정, 확인한 내용 등을 기록합니다."
            aria-label="내부 메모"
            className="bg-ground border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
          />
        </label>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="self-start border border-line rounded-lg px-3 py-1.5 text-sm hover:bg-ground disabled:opacity-50 transition-colors"
        >
          메모 추가
        </button>
      </form>

      <div className="mt-4 pt-4 border-t border-line">
        {notes.length === 0 ? (
          <p className="text-sm text-muted">등록된 메모가 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {notes.map((note) => (
              <li key={note.id} className="text-sm">
                <p className="text-xs text-muted mb-1">
                  <span title={note.authorEmail}>{emailLocalPart(note.authorEmail)}</span>
                  {" · "}
                  {formatReceivedAt(note.createdAt)}
                </p>
                <p className="whitespace-pre-wrap">{note.content}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/components/InquiryNotes.test.tsx`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add components/inquiries/InquiryNotes.tsx tests/components/InquiryNotes.test.tsx
git commit -m "feat: add internal notes card to the inquiry detail"
```

---

### Task 10: `InquiryEventLog` 컴포넌트

**Files:**
- Create: `components/inquiries/InquiryEventLog.tsx`
- Test: `tests/components/InquiryEventLog.test.tsx`

**Interfaces:**
- Consumes: `EventRow` · `describeEvent` (Task 4), `emailLocalPart` · `formatReceivedAt`
- Produces: `<InquiryEventLog events={EventRow[]} createdAt={string} />`

`createdAt`은 `inquiries.created_at`이다. 맨 아래 "접수" 줄을 여기서 합성한다 — 저장하지 않는 이유는 스펙 결정 1 참고.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/components/InquiryEventLog.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import InquiryEventLog from "@/components/inquiries/InquiryEventLog";
import type { EventRow } from "@/lib/events";

const events: EventRow[] = [
  {
    id: "evt-2",
    actorEmail: "info@theplayplus.com",
    kind: "reply_sent",
    fromValue: null,
    toValue: null,
    createdAt: "2026-09-02T05:00:00.000Z",
  },
  {
    id: "evt-1",
    actorEmail: "info@theplayplus.com",
    kind: "status_changed",
    fromValue: "new",
    toValue: "resolved",
    createdAt: "2026-09-02T04:00:00.000Z",
  },
];

describe("InquiryEventLog", () => {
  it("renders each event with a Korean description and the actor id part", () => {
    render(<InquiryEventLog events={events} createdAt="2026-09-02T03:00:00.000Z" />);
    expect(screen.getByText("변경 이력")).toBeInTheDocument();
    expect(screen.getByText("답변 발송")).toBeInTheDocument();
    expect(screen.getByText("상태 접수 → 완료")).toBeInTheDocument();
    expect(screen.getAllByText("info").length).toBeGreaterThan(0);
  });

  it("appends a synthesized 접수 entry at the end", () => {
    render(<InquiryEventLog events={events} createdAt="2026-09-02T03:00:00.000Z" />);
    const items = screen.getAllByRole("listitem");
    expect(items[items.length - 1].textContent).toContain("접수");
  });

  it("shows the 접수 entry even with no recorded events", () => {
    render(<InquiryEventLog events={[]} createdAt="2026-09-02T03:00:00.000Z" />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain("접수");
    expect(items[0].textContent).toContain("사용자");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/InquiryEventLog.test.tsx`
Expected: FAIL — 모듈 미해결

- [ ] **Step 3: 구현**

`components/inquiries/InquiryEventLog.tsx`:

```tsx
import type { EventRow } from "@/lib/events";
import { describeEvent } from "@/lib/events";
import { emailLocalPart, formatReceivedAt } from "@/lib/format";

export default function InquiryEventLog({
  events,
  createdAt,
}: {
  events: EventRow[];
  createdAt: string;
}) {
  return (
    <section className="bg-panel border border-line rounded-2xl p-4">
      <h2 className="font-semibold mb-3">변경 이력</h2>
      <ul className="flex flex-col gap-3 text-sm">
        {events.map((event) => (
          <li key={event.id}>
            <p className="text-xs text-muted">{formatReceivedAt(event.createdAt)}</p>
            <p>{describeEvent(event)}</p>
            <p className="text-xs text-muted" title={event.actorEmail}>
              {emailLocalPart(event.actorEmail)}
            </p>
          </li>
        ))}

        {/* 접수 이벤트는 저장하지 않는다. contact 폼이 anon으로 직접 insert하므로
            저장하려면 트리거가 필요한데, created_at이 이미 같은 정보를 갖고 있다. */}
        <li>
          <p className="text-xs text-muted">{formatReceivedAt(createdAt)}</p>
          <p>접수</p>
          <p className="text-xs text-muted">사용자</p>
        </li>
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/components/InquiryEventLog.test.tsx`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add components/inquiries/InquiryEventLog.tsx tests/components/InquiryEventLog.test.tsx
git commit -m "feat: add change history card with synthesized intake entry"
```

---

### Task 11: `ReplyForm` 초안 저장 + 페이지 조립

**Files:**
- Modify: `components/inquiries/ReplyForm.tsx`
- Modify: `app/(admin)/inquiries/[id]/page.tsx`
- Test: `tests/components/ReplyForm.test.tsx`

**Interfaces:**
- Consumes: `PUT /api/inquiries/[id]/draft` (Task 8), `listNotes` (Task 5), `listEvents` (Task 4), `InquiryNotes` (Task 9), `InquiryEventLog` (Task 10)
- Produces: `<ReplyForm inquiryId={string} initialDraft={string | null} />`

- [ ] **Step 1: 테스트 수정**

`tests/components/ReplyForm.test.tsx`의 기존 3개 테스트에서 `<ReplyForm inquiryId="inq-1" />`를 `<ReplyForm inquiryId="inq-1" initialDraft={null} />`로 바꾸고, 파일 끝 `describe` 안에 다음을 추가한다:

```tsx
  it("prefills the textarea with an existing draft", () => {
    render(<ReplyForm inquiryId="inq-1" initialDraft="작성하던 답변" />);
    expect(screen.getByLabelText("답변 내용")).toHaveValue("작성하던 답변");
  });

  it("saves the draft without sending", async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true }) }) as never;
    render(<ReplyForm inquiryId="inq-1" initialDraft={null} />);

    await userEvent.type(screen.getByLabelText("답변 내용"), "나중에 이어서");
    await userEvent.click(screen.getByRole("button", { name: "초안 저장" }));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/inquiries/inq-1/draft",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ draftReply: "나중에 이어서" }) })
    );
    expect(await screen.findByText("초안을 저장했습니다.")).toBeInTheDocument();
  });

  it("shows an error when saving the draft fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: false }) }) as never;
    render(<ReplyForm inquiryId="inq-1" initialDraft={null} />);

    await userEvent.type(screen.getByLabelText("답변 내용"), "나중에 이어서");
    await userEvent.click(screen.getByRole("button", { name: "초안 저장" }));

    expect(await screen.findByText("초안 저장에 실패했습니다.")).toBeInTheDocument();
    expect(screen.getByLabelText("답변 내용")).toHaveValue("나중에 이어서");
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/ReplyForm.test.tsx`
Expected: FAIL — "초안 저장" 버튼 없음

- [ ] **Step 3: `ReplyForm` 구현**

`components/inquiries/ReplyForm.tsx` 전체를 교체한다:

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function ReplyForm({
  inquiryId,
  initialDraft,
}: {
  inquiryId: string;
  initialDraft: string | null;
}) {
  const router = useRouter();
  const [replyContent, setReplyContent] = useState(initialDraft ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    let json: { success: boolean };
    try {
      const response = await fetch(`/api/inquiries/${inquiryId}/reply`, {
        method: "POST",
        body: JSON.stringify({ replyContent }),
      });
      json = await response.json();
    } catch {
      setSubmitting(false);
      setMessage("발송 실패, 다시 시도해주세요.");
      return;
    }
    setSubmitting(false);

    if (!json.success) {
      setMessage("발송 실패, 다시 시도해주세요.");
      return;
    }

    setMessage("답변이 발송되었습니다.");
    setReplyContent("");
    router.refresh();
  }

  async function handleSaveDraft() {
    setSavingDraft(true);
    setMessage(null);

    let json: { success: boolean };
    try {
      const response = await fetch(`/api/inquiries/${inquiryId}/draft`, {
        method: "PUT",
        body: JSON.stringify({ draftReply: replyContent }),
      });
      json = await response.json();
    } catch {
      setSavingDraft(false);
      setMessage("초안 저장에 실패했습니다.");
      return;
    }
    setSavingDraft(false);

    if (!json.success) {
      setMessage("초안 저장에 실패했습니다.");
      return;
    }

    setMessage("초안을 저장했습니다.");
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="sr-only">답변 내용</span>
        <textarea
          value={replyContent}
          onChange={(e) => setReplyContent(e.target.value)}
          required
          rows={6}
          aria-label="답변 내용"
          placeholder="사용자에게 전달할 답변을 작성합니다."
          className="bg-ground border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
        />
      </label>
      {message && <p className="text-sm">{message}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSaveDraft}
          disabled={savingDraft || submitting}
          className="border border-line rounded-lg px-3 py-1.5 text-sm hover:bg-ground disabled:opacity-50 transition-colors"
        >
          초안 저장
        </button>
        <button
          type="submit"
          disabled={submitting || savingDraft}
          className="bg-accent text-white rounded-lg px-4 py-1.5 text-sm hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:ring-offset-2 focus:ring-offset-panel disabled:opacity-50 transition-colors"
        >
          답변 발송
        </button>
      </div>
    </form>
  );
}
```

> 기존 코드의 `<span>답변 내용</span>`은 화면에 보이는 라벨이었으나, 카드 제목이 이미 "답변"이라 중복된다. `sr-only` + `aria-label`로 바꿔 접근성은 유지하고 시각적 중복만 없앤다. 테스트의 `getByLabelText("답변 내용")`은 그대로 동작한다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/components/ReplyForm.test.tsx`
Expected: PASS (기존 3개 + 신규 3개)

- [ ] **Step 5: 페이지 조립**

`app/(admin)/inquiries/[id]/page.tsx`에서:

import에 다음을 추가한다:

```ts
import { listNotes } from "@/lib/notes";
import { listEvents } from "@/lib/events";
import InquiryNotes from "@/components/inquiries/InquiryNotes";
import InquiryEventLog from "@/components/inquiries/InquiryEventLog";
```

`Promise.all` 배열을 다음으로 교체한다:

```ts
  const [attachments, history, labels, notes, events] = await Promise.all([
    listAttachmentSignedUrls(supabase, inquiry.id),
    getAccountHistory(supabase, inquiry.gameId, inquiry.gameAccount, inquiry.id),
    listCategoryLabels(supabase, inquiry.gameId),
    listNotes(supabase, inquiry.id),
    listEvents(supabase, inquiry.id),
  ]);
```

좌측 컬럼을 다음으로 교체한다 (메모 카드가 답변 카드 위):

```tsx
        <div className="flex flex-col gap-4">
          <InquiryDetail inquiry={inquiry} attachments={attachments} />
          <InquiryNotes inquiryId={inquiry.id} notes={notes} />
          <section className="bg-panel border border-line rounded-2xl p-4">
            <h2 className="font-semibold mb-3">답변</h2>
            <ReplyForm inquiryId={inquiry.id} initialDraft={inquiry.draftReply} />
          </section>
        </div>
```

우측 컬럼의 `<InquiryMetaCard ... />`와 `<AccountHistoryPanel ... />` 사이에 다음을 넣는다:

```tsx
          <InquiryEventLog events={events} createdAt={inquiry.createdAt} />
```

- [ ] **Step 6: 전체 검증**

Run: `npx tsc --noEmit && npx vitest run && npx next build`
Expected: 타입 에러 없음, 모든 테스트 PASS, 빌드 성공

- [ ] **Step 7: 커밋**

```bash
git add components/inquiries/ReplyForm.tsx "app/(admin)/inquiries/[id]/page.tsx" tests/components/ReplyForm.test.tsx
git commit -m "feat: add draft saving to ReplyForm and wire notes and history into the page"
```

---

## 완료 후 보고 항목

- `npx tsc --noEmit` 결과
- `npx vitest run` 결과 (통과/실패 수)
- `npx next build` 결과
- **`supabase/migrations/0003_...sql`은 사람이 Supabase에 직접 적용해야 한다.** 적용 전에는 메모 추가와 초안 저장이 500으로 실패하고 변경 이력에는 "접수" 줄만 보인다.
- 1단계의 `0002`가 아직 적용되지 않았다면 그것도 함께 적용해야 한다.
