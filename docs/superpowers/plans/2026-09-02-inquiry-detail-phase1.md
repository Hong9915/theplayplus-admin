# 문의 상세 개편 1단계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 문의에 `R-YYYYMMDD-NNNN` 접수번호와 우선순위를 도입하고, 문의 상세 화면을 헤더 / 본문 카드 / 사이드 카드 구조로 재구성한다.

**Architecture:** 접수번호는 Next.js가 아니라 Postgres 트리거가 붙인다 — `theplayplus-contact`의 접수 폼이 anon 권한으로 `inquiries`에 직접 insert하므로 앱 레이어에서 채번하면 그쪽 문의에 번호가 빠진다. 날짜별 시퀀스 테이블(`inquiry_number_seq`)에 `on conflict do update ... returning`으로 원자적 증가시켜 동시 접수 시 중복을 막는다. 화면 쪽은 표시 로직을 순수 함수(`lib/format.ts`)로 뽑아 테스트하고, 비대해진 `InquiryDetail`을 헤더 · 접수정보 카드로 쪼갠다.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS, Supabase (Postgres + service-role 클라이언트), zod, Vitest + React Testing Library

**Spec:** `docs/superpowers/specs/2026-09-02-inquiry-detail-phase1-design.md`

## Global Constraints

- 관리자 UI는 **한국어 전용**. 새로 넣는 라벨·에러 메시지도 전부 한국어.
- 접수번호 포맷은 `R-YYYYMMDD-NNNN` (접두어 `R` 고정, 일련번호 4자리 zero-pad).
- 접수번호의 날짜는 **`Asia/Seoul` 기준**. `created_at`은 `timestamptz`(UTC 저장)이므로 변환 없이 자르면 하루가 밀린다.
- 우선순위 값은 `urgent` / `high` / `normal` / `low`, 기본값 `normal`. 한국어 라벨은 `긴급` / `높음` / `보통` / `낮음`.
- 카드 스타일은 기존 컨벤션을 따른다: `bg-panel border border-line rounded-2xl`. 색상은 Tailwind 임의값이 아니라 기존 토큰(`ink`, `muted`, `line`, `panel`, `ground`, `accent`)을 쓴다.
- 마이그레이션은 **재실행 가능해야** 한다 (`if not exists`, `create or replace`, `drop ... if exists`). 사람이 Supabase에 직접 적용한다.
- 테스트 실행은 `npx vitest run <path>` (프로젝트 스크립트는 `npm test`).
- 담당자(assignee), 내부 메모, 변경 이력, LLM 답변 추천은 **이번 범위 밖**이다. 만들지 마라.

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `supabase/migrations/0002_inquiry_number_and_priority.sql` | 접수번호 컬럼·시퀀스 테이블·트리거·소급 부여, 우선순위 컬럼 | 생성 |
| `lib/format.ts` | 표시용 순수 함수 — 경과 시간, 접수 시각, `meta` 렌더 목록 | 생성 |
| `lib/inquiries.ts` | `InquiryRow`에 `inquiryNo` · `priority` · `meta` 추가 | 수정 |
| `app/api/inquiries/[id]/priority/route.ts` | 우선순위 변경 PATCH | 생성 |
| `app/api/inquiries/[id]/reply/route.ts` | 메일 제목에 접수번호 삽입 | 수정 |
| `components/inquiries/PrioritySelect.tsx` | 우선순위 드롭다운 (낙관적 갱신 + 롤백) | 생성 |
| `components/inquiries/InquiryHeader.tsx` | 접수번호 + 제목 + 상태배지 · 종류 · 유형 · 접수시각 · 경과 | 생성 |
| `components/inquiries/InquiryMetaCard.tsx` | 사이드 "접수 정보" 카드 | 생성 |
| `components/inquiries/InquiryDetail.tsx` | 문의 내용 · 첨부 · 보낸 답변 카드만 담당 | 수정 |
| `components/inquiries/InquiryMailbox.tsx` | 접수번호 컬럼, 경과 표기, 검색 확대 | 수정 |
| `app/(admin)/inquiries/[id]/page.tsx` | 새 레이아웃 조립, 카테고리 라벨 조회 추가 | 수정 |

**Task 순서 의존성:** Task 2(`lib/format.ts`) → Task 3(`lib/inquiries.ts` 타입) → 나머지. Task 4~10은 Task 3 이후라면 서로 독립적이다.

---

### Task 1: 마이그레이션 — 접수번호와 우선순위

**Files:**
- Create: `supabase/migrations/0002_inquiry_number_and_priority.sql`

**Interfaces:**
- Consumes: `supabase/migrations/0001_admin_schema.sql`의 `inquiries` 테이블
- Produces: `inquiries.inquiry_no` (text, unique, nullable), `inquiries.priority` (text, not null, default `'normal'`), `inquiry_number_seq` 테이블, `assign_inquiry_no()` 트리거 함수

이 태스크는 SQL만 다룬다. Vitest로 덮지 않고 Step 3의 수동 검증으로 확인한다.

- [ ] **Step 1: 마이그레이션 파일 작성**

`supabase/migrations/0002_inquiry_number_and_priority.sql`:

```sql
-- 접수번호(R-YYYYMMDD-NNNN)와 우선순위를 추가한다.
--
-- 채번을 DB 트리거에서 하는 이유: theplayplus-contact의 접수 폼은 이
-- 저장소의 API를 거치지 않고 anon 권한으로 inquiries에 직접 insert한다
-- (0001의 "Allow public insert on inquiries" 정책). 앱 레이어에서 번호를
-- 붙이면 그 경로로 들어온 문의에는 번호가 빠진다.

alter table inquiries add column if not exists inquiry_no text;
alter table inquiries add column if not exists priority text not null default 'normal';

create table if not exists inquiry_number_seq (
  seq_date date primary key,
  last_seq  int  not null default 0
);

-- 날짜는 Asia/Seoul 기준. created_at은 timestamptz(UTC 저장)이므로 변환
-- 없이 자르면 한국 시간 오전 9시 이전 접수 건이 전날로 밀린다.
create or replace function assign_inquiry_no() returns trigger as $$
declare
  d date;
  n int;
begin
  if new.inquiry_no is not null then
    return new;
  end if;

  d := (coalesce(new.created_at, now()) at time zone 'Asia/Seoul')::date;

  insert into inquiry_number_seq (seq_date, last_seq)
  values (d, 1)
  on conflict (seq_date) do update set last_seq = inquiry_number_seq.last_seq + 1
  returning last_seq into n;

  new.inquiry_no := 'R-' || to_char(d, 'YYYYMMDD') || '-' || lpad(n::text, 4, '0');
  return new;
end $$ language plpgsql;

drop trigger if exists inquiries_assign_no on inquiries;
create trigger inquiries_assign_no
  before insert on inquiries
  for each row execute function assign_inquiry_no();

-- 기존 문의 소급 부여. KST 날짜별로 묶고 created_at 오름차순, 동률이면
-- id 오름차순으로 번호를 매긴다. 정렬 기준을 못 박아야 재실행해도 같은
-- 결과가 나온다.
with numbered as (
  select
    id,
    (created_at at time zone 'Asia/Seoul')::date as seq_date,
    row_number() over (
      partition by (created_at at time zone 'Asia/Seoul')::date
      order by created_at, id
    ) as seq
  from inquiries
  where inquiry_no is null
)
update inquiries i
set inquiry_no = 'R-' || to_char(n.seq_date, 'YYYYMMDD') || '-' || lpad(n.seq::text, 4, '0')
from numbered n
where i.id = n.id;

-- 소급 부여한 날짜들의 최대 번호를 시퀀스에 심어 이후 채번이 이어지게 한다.
insert into inquiry_number_seq (seq_date, last_seq)
select
  (created_at at time zone 'Asia/Seoul')::date as seq_date,
  count(*)::int as last_seq
from inquiries
group by 1
on conflict (seq_date) do update
  set last_seq = greatest(inquiry_number_seq.last_seq, excluded.last_seq);

-- 유일 제약은 반드시 소급 부여 뒤에 건다. 먼저 걸면 null이 여러 개라
-- 통과하지만, 순서를 지켜야 백필 결과를 즉시 검증하는 효과가 있다.
alter table inquiries drop constraint if exists inquiries_inquiry_no_key;
alter table inquiries add constraint inquiries_inquiry_no_key unique (inquiry_no);
```

- [ ] **Step 2: 파일 커밋**

```bash
git add supabase/migrations/0002_inquiry_number_and_priority.sql
git commit -m "feat: add inquiry number sequence and priority column migration"
```

- [ ] **Step 3: 수동 검증 항목을 기록**

이 단계는 사람이 Supabase에 마이그레이션을 적용한 뒤 확인한다. 구현 에이전트는 이 항목들을 최종 보고에 그대로 옮겨 적고, 자동으로 검증했다고 주장하지 마라.

1. 문의 2건을 연속 삽입 → `R-<오늘>-0001`, `R-<오늘>-0002`가 붙는가
2. `created_at`을 한국 시간 오전 8시로 지정해 삽입 → 전날이 아닌 당일 날짜가 붙는가
3. 소급 부여 후 새 문의를 넣으면 기존 최대 번호 다음으로 이어지는가
4. 마이그레이션을 두 번 돌려도 오류 없이 끝나는가

---

### Task 2: `lib/format.ts` — 표시용 순수 함수

**Files:**
- Create: `lib/format.ts`
- Test: `tests/lib/format.test.ts`

**Interfaces:**
- Consumes: 없음 (순수 함수)
- Produces:
  - `formatElapsed(iso: string, now?: Date): string`
  - `formatReceivedAt(iso: string): string`
  - `metaEntries(meta: unknown): MetaEntry[]`
  - `interface MetaEntry { key: string; label: string; value: string }`

> 스펙에는 `metaEntries`가 `Array<{ key, value }>`로 적혀 있으나, 화면에서 `uid` → `UID` 같은 한국어 라벨 변환이 필요하므로 `label`을 포함한 3필드로 넓혔다. 라벨 매핑을 컴포넌트에 두면 테스트가 어려워진다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/lib/format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatElapsed, formatReceivedAt, metaEntries } from "@/lib/format";

const NOW = new Date("2026-07-23T12:00:00.000Z");

function minutesAgo(n: number): string {
  return new Date(NOW.getTime() - n * 60_000).toISOString();
}

describe("formatElapsed", () => {
  it("shows minutes under an hour", () => {
    expect(formatElapsed(minutesAgo(0), NOW)).toBe("0분");
    expect(formatElapsed(minutesAgo(59), NOW)).toBe("59분");
  });

  it("switches to hours at 60 minutes", () => {
    expect(formatElapsed(minutesAgo(60), NOW)).toBe("1시간");
    expect(formatElapsed(minutesAgo(60 * 23), NOW)).toBe("23시간");
  });

  it("switches to days at 24 hours", () => {
    expect(formatElapsed(minutesAgo(60 * 24), NOW)).toBe("1일");
    expect(formatElapsed(minutesAgo(60 * 24 * 3), NOW)).toBe("3일");
  });

  it("clamps a future timestamp to 0분", () => {
    expect(formatElapsed(new Date(NOW.getTime() + 60_000).toISOString(), NOW)).toBe("0분");
  });
});

describe("formatReceivedAt", () => {
  it("formats an afternoon time in Korean", () => {
    // 2026-07-23 22:55 KST
    expect(formatReceivedAt("2026-07-23T13:55:00.000Z")).toContain("2026. 07. 23.");
  });

  it("renders noon as 오후 12 and midnight as 오전 12", () => {
    const noon = new Date(2026, 6, 23, 12, 0).toISOString();
    const midnight = new Date(2026, 6, 23, 0, 0).toISOString();
    expect(formatReceivedAt(noon)).toBe("2026. 07. 23. 오후 12:00");
    expect(formatReceivedAt(midnight)).toBe("2026. 07. 23. 오전 12:00");
  });
});

describe("metaEntries", () => {
  it("returns an empty array for non-objects", () => {
    expect(metaEntries(null)).toEqual([]);
    expect(metaEntries(undefined)).toEqual([]);
    expect(metaEntries("uid")).toEqual([]);
    expect(metaEntries([1, 2])).toEqual([]);
    expect(metaEntries({})).toEqual([]);
  });

  it("labels known keys in a fixed order regardless of input order", () => {
    const result = metaEntries({ device: "SM-S938N", uid: "10024871", server: "kr-01" });
    expect(result).toEqual([
      { key: "uid", label: "UID", value: "10024871" },
      { key: "server", label: "서버", value: "kr-01" },
      { key: "device", label: "기기", value: "SM-S938N" },
    ]);
  });

  it("appends unknown keys after known ones, sorted by key", () => {
    const result = metaEntries({ zeta: "z", uid: "1", alpha: "a" });
    expect(result.map((entry) => entry.key)).toEqual(["uid", "alpha", "zeta"]);
    expect(result[1]).toEqual({ key: "alpha", label: "alpha", value: "a" });
  });

  it("drops null, undefined, and blank values", () => {
    const result = metaEntries({ uid: "1", server: null, nickname: "", platform: "   " });
    expect(result.map((entry) => entry.key)).toEqual(["uid"]);
  });

  it("stringifies object and number values", () => {
    const result = metaEntries({ uid: 10024871, extra: { a: 1 } });
    expect(result).toEqual([
      { key: "uid", label: "UID", value: "10024871" },
      { key: "extra", label: "extra", value: '{"a":1}' },
    ]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/lib/format.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/format"`

- [ ] **Step 3: 구현**

`lib/format.ts`:

```ts
export interface MetaEntry {
  key: string;
  label: string;
  value: string;
}

const META_LABELS: Record<string, string> = {
  uid: "UID",
  server: "서버",
  nickname: "닉네임",
  app_version: "앱 버전",
  platform: "플랫폼",
  device: "기기",
};

const META_ORDER = Object.keys(META_LABELS);

/** 접수 후 지난 시간. 1시간 미만은 분, 24시간 미만은 시간, 그 이상은 일. */
export function formatElapsed(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(iso).getTime();
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 60) {
    return `${minutes}분`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}시간`;
  }
  return `${Math.floor(hours / 24)}일`;
}

/** "2026. 07. 23. 오후 10:55" */
export function formatReceivedAt(iso: string): string {
  const date = new Date(iso);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hours = date.getHours();
  const meridiem = hours < 12 ? "오전" : "오후";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}. ${mm}. ${dd}. ${meridiem} ${hour12}:${min}`;
}

/**
 * inquiries.meta는 theplayplus-contact가 넣는 값이라 스키마를 알 수 없다.
 * 검증하지 않고 방어적으로 렌더 가능한 목록만 뽑아낸다.
 */
export function metaEntries(meta: unknown): MetaEntry[] {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return [];
  }

  const record = meta as Record<string, unknown>;
  const presentKeys = Object.keys(record);
  const known = META_ORDER.filter((key) => presentKeys.includes(key));
  const unknown = presentKeys.filter((key) => !META_ORDER.includes(key)).sort();

  const entries: MetaEntry[] = [];
  for (const key of [...known, ...unknown]) {
    const raw = record[key];
    if (raw === null || raw === undefined) {
      continue;
    }
    const value = typeof raw === "object" ? JSON.stringify(raw) : String(raw);
    if (value.trim() === "") {
      continue;
    }
    entries.push({ key, label: META_LABELS[key] ?? key, value });
  }
  return entries;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/lib/format.test.ts`
Expected: PASS (모든 테스트)

- [ ] **Step 5: 커밋**

```bash
git add lib/format.ts tests/lib/format.test.ts
git commit -m "feat: add display formatters for elapsed time, received time, and meta"
```

---

### Task 3: `InquiryRow`에 `inquiryNo` · `priority` · `meta` 추가

**Files:**
- Modify: `lib/inquiries.ts`
- Test: `tests/lib/inquiries.test.ts`
- Modify (픽스처 보정): `tests/components/InquiryDetail.test.tsx`, `tests/components/InquiryMailbox.test.tsx`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `type InquiryPriority = "urgent" | "high" | "normal" | "low"`
  - `InquiryRow`에 `inquiryNo: string | null`, `priority: InquiryPriority`, `meta: Record<string, unknown>` 추가

`inquiryNo`를 nullable로 두는 이유: 트리거가 붙기 전에 삽입된 행이 남을 수 있다. 그 경우 화면은 `—`를 보여주고 넘어가면 되며, 없는 값 때문에 상세 화면이 통째로 죽는 쪽이 나쁘다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/lib/inquiries.test.ts`의 최상단 `sampleRow`에 세 필드를 추가한다:

```ts
const sampleRow = {
  id: "inq-1",
  game_id: "game-1",
  group_key: "game_usage",
  type_key: "bug_report",
  game_account: "player1",
  company_name: null,
  reply_email: "a@b.com",
  title: "제목",
  content: "내용",
  status: "new",
  reply_content: null,
  replied_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  inquiry_no: "R-20260101-0001",
  priority: "high",
  meta: { uid: "10024871" },
};
```

그리고 파일 끝에 다음 describe 블록을 추가한다:

```ts
describe("mapInquiryRow via getInquiryById", () => {
  function mockSingle(row: unknown) {
    const single = vi.fn().mockResolvedValue({ data: row, error: null });
    const eq = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq }));
    return { from: vi.fn(() => ({ select })) };
  }

  it("maps inquiry_no, priority, and meta", async () => {
    const result = await getInquiryById(mockSingle(sampleRow) as never, "inq-1");
    expect(result?.inquiryNo).toBe("R-20260101-0001");
    expect(result?.priority).toBe("high");
    expect(result?.meta).toEqual({ uid: "10024871" });
  });

  it("falls back when inquiry_no, priority, and meta are missing", async () => {
    const bare = { ...sampleRow, inquiry_no: null, priority: null, meta: null };
    const result = await getInquiryById(mockSingle(bare) as never, "inq-1");
    expect(result?.inquiryNo).toBeNull();
    expect(result?.priority).toBe("normal");
    expect(result?.meta).toEqual({});
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/lib/inquiries.test.ts`
Expected: FAIL — `expected undefined to be 'R-20260101-0001'`

- [ ] **Step 3: 구현**

`lib/inquiries.ts` 수정. 타입 선언부:

```ts
export type InquiryStatus = "new" | "in_progress" | "resolved";
export type InquiryPriority = "urgent" | "high" | "normal" | "low";

export interface InquiryRow {
  id: string;
  inquiryNo: string | null;
  gameId: string;
  groupKey: string;
  typeKey: string;
  gameAccount: string | null;
  companyName: string | null;
  replyEmail: string;
  title: string;
  content: string;
  status: InquiryStatus;
  priority: InquiryPriority;
  meta: Record<string, unknown>;
  replyContent: string | null;
  repliedAt: string | null;
  createdAt: string;
}
```

`mapInquiryRow`의 파라미터 타입에 세 필드를 추가하고(`inquiry_no: string | null; priority: string | null; meta: Record<string, unknown> | null;`), 반환 객체에 다음을 추가한다:

```ts
    inquiryNo: row.inquiry_no ?? null,
    priority: (row.priority ?? "normal") as InquiryPriority,
    meta: row.meta ?? {},
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/lib/inquiries.test.ts`
Expected: PASS

- [ ] **Step 5: 기존 컴포넌트 테스트 픽스처 보정**

`InquiryRow`에 필수 필드가 늘어나 두 파일의 픽스처가 타입 에러를 낸다. 각 픽스처 객체에 다음 세 줄을 추가한다.

`tests/components/InquiryDetail.test.tsx`의 `const inquiry: InquiryRow = { ... }` 안:

```ts
    inquiryNo: "R-20260101-0001",
    priority: "normal",
    meta: {},
```

`tests/components/InquiryMailbox.test.tsx`의 `makeInquiry` 기본값 안 (`...overrides` 앞):

```ts
    inquiryNo: "R-20260101-0001",
    priority: "normal",
    meta: {},
```

- [ ] **Step 6: 타입 체크와 전체 테스트**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 타입 에러 없음, 모든 테스트 PASS

- [ ] **Step 7: 커밋**

```bash
git add lib/inquiries.ts tests/lib/inquiries.test.ts tests/components/InquiryDetail.test.tsx tests/components/InquiryMailbox.test.tsx
git commit -m "feat: expose inquiry number, priority, and meta on InquiryRow"
```

---

### Task 4: 우선순위 변경 API

**Files:**
- Create: `app/api/inquiries/[id]/priority/route.ts`
- Test: `tests/api/inquiry-priority.test.ts`

**Interfaces:**
- Consumes: `InquiryPriority` (Task 3), `requireAdminSession()` from `@/lib/require-admin-session`, `getSupabaseServerClient()` from `@/lib/supabase`
- Produces: `PATCH(request: Request, ctx: { params: { id: string } }): Promise<NextResponse>` — `{ success: true }` 또는 `{ success: false, error: "unauthorized" | "invalid_priority" | "update_failed" }`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/api/inquiry-priority.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PATCH } from "@/app/api/inquiries/[id]/priority/route";
import * as supabaseModule from "@/lib/supabase";
import * as requireAdminSessionModule from "@/lib/require-admin-session";

vi.mock("@/lib/supabase", () => ({
  getSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/require-admin-session", () => ({
  requireAdminSession: vi.fn(),
}));

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/inquiries/inq-1/priority", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/inquiries/[id]/priority", () => {
  beforeEach(() => {
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReset();
    vi.mocked(requireAdminSessionModule.requireAdminSession).mockReset().mockResolvedValue(true);
  });

  it("returns 401 when there is no admin session", async () => {
    vi.mocked(requireAdminSessionModule.requireAdminSession).mockResolvedValue(false);

    const response = await PATCH(patchRequest({ priority: "urgent" }), { params: { id: "inq-1" } });
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({ success: false, error: "unauthorized" });
  });

  it("updates the priority and returns success", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({ from } as never);

    const response = await PATCH(patchRequest({ priority: "urgent" }), { params: { id: "inq-1" } });
    const json = await response.json();

    expect(from).toHaveBeenCalledWith("inquiries");
    expect(update).toHaveBeenCalledWith({ priority: "urgent" });
    expect(eq).toHaveBeenCalledWith("id", "inq-1");
    expect(json).toEqual({ success: true });
  });

  it("rejects an invalid priority value", async () => {
    const response = await PATCH(patchRequest({ priority: "bogus" }), { params: { id: "inq-1" } });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ success: false, error: "invalid_priority" });
  });

  it("returns 500 when the update fails", async () => {
    const eq = vi.fn().mockResolvedValue({ error: { message: "db error" } });
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({ from } as never);

    const response = await PATCH(patchRequest({ priority: "low" }), { params: { id: "inq-1" } });
    expect(response.status).toBe(500);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/api/inquiry-priority.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/inquiries/[id]/priority/route"`

- [ ] **Step 3: 구현**

`app/api/inquiries/[id]/priority/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";

const prioritySchema = z.object({ priority: z.enum(["urgent", "high", "normal", "low"]) });

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = prioritySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_priority" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("inquiries").update({ priority: parsed.data.priority }).eq("id", params.id);

  if (error) {
    return NextResponse.json({ success: false, error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/api/inquiry-priority.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add app/api/inquiries/\[id\]/priority/route.ts tests/api/inquiry-priority.test.ts
git commit -m "feat: add inquiry priority update API route"
```

---

### Task 5: `PrioritySelect` 컴포넌트

**Files:**
- Create: `components/inquiries/PrioritySelect.tsx`
- Test: `tests/components/PrioritySelect.test.tsx`

**Interfaces:**
- Consumes: `InquiryPriority` (Task 3), `PATCH /api/inquiries/[id]/priority` (Task 4)
- Produces: `<PrioritySelect inquiryId={string} currentPriority={InquiryPriority} />`

`StatusSelect`와 같은 패턴이다 — 낙관적으로 값을 바꾸고, 요청이 실패하면 이전 값으로 되돌리며 에러 문구를 띄운다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/components/PrioritySelect.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PrioritySelect from "@/components/inquiries/PrioritySelect";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

describe("PrioritySelect", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true }) }) as never;
  });

  it("sends a PATCH request and refreshes on change", async () => {
    render(<PrioritySelect inquiryId="inq-1" currentPriority="normal" />);
    await userEvent.selectOptions(screen.getByLabelText("우선순위"), "긴급");

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/inquiries/inq-1/priority",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ priority: "urgent" }),
      })
    );
    expect(refreshMock).toHaveBeenCalled();
  });

  it("reverts and shows an error when the request throws", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network error")) as never;
    render(<PrioritySelect inquiryId="inq-1" currentPriority="normal" />);

    await userEvent.selectOptions(screen.getByLabelText("우선순위"), "긴급");

    expect(await screen.findByText("우선순위 변경에 실패했습니다.")).toBeInTheDocument();
    expect(screen.getByLabelText("우선순위")).toHaveValue("normal");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("reverts when the API returns success: false", async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: false }) }) as never;
    render(<PrioritySelect inquiryId="inq-1" currentPriority="low" />);

    await userEvent.selectOptions(screen.getByLabelText("우선순위"), "높음");

    expect(await screen.findByText("우선순위 변경에 실패했습니다.")).toBeInTheDocument();
    expect(screen.getByLabelText("우선순위")).toHaveValue("low");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/PrioritySelect.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/inquiries/PrioritySelect"`

- [ ] **Step 3: 구현**

`components/inquiries/PrioritySelect.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { InquiryPriority } from "@/lib/inquiries";

const OPTIONS: Array<{ value: InquiryPriority; label: string }> = [
  { value: "urgent", label: "긴급" },
  { value: "high", label: "높음" },
  { value: "normal", label: "보통" },
  { value: "low", label: "낮음" },
];

export default function PrioritySelect({
  inquiryId,
  currentPriority,
}: {
  inquiryId: string;
  currentPriority: InquiryPriority;
}) {
  const router = useRouter();
  const [priority, setPriority] = useState(currentPriority);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(next: InquiryPriority) {
    const previous = priority;
    setPriority(next);
    setError(null);

    let json: { success: boolean };
    try {
      const response = await fetch(`/api/inquiries/${inquiryId}/priority`, {
        method: "PATCH",
        body: JSON.stringify({ priority: next }),
      });
      json = await response.json();
    } catch {
      setPriority(previous);
      setError("우선순위 변경에 실패했습니다.");
      return;
    }

    if (!json.success) {
      setPriority(previous);
      setError("우선순위 변경에 실패했습니다.");
      return;
    }

    router.refresh();
  }

  return (
    <div>
      <label className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted">우선순위</span>
        <select
          value={priority}
          onChange={(e) => handleChange(e.target.value as InquiryPriority)}
          className="bg-panel border border-line rounded-lg px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
        >
          {OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="text-red-600 text-sm mt-1">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/components/PrioritySelect.test.tsx`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add components/inquiries/PrioritySelect.tsx tests/components/PrioritySelect.test.tsx
git commit -m "feat: add PrioritySelect with optimistic update and rollback"
```

---

### Task 6: `InquiryHeader` 컴포넌트

**Files:**
- Create: `components/inquiries/InquiryHeader.tsx`
- Test: `tests/components/InquiryHeader.test.tsx`

**Interfaces:**
- Consumes: `InquiryRow` (Task 3), `formatElapsed` · `formatReceivedAt` (Task 2), `StatusBadge` from `@/components/ui/StatusBadge`, `CategoryLabelMaps` from `@/lib/categories`
- Produces: `<InquiryHeader inquiry={InquiryRow} labels={CategoryLabelMaps} />`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/components/InquiryHeader.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import InquiryHeader from "@/components/inquiries/InquiryHeader";
import type { InquiryRow } from "@/lib/inquiries";

const labels = {
  groupLabels: { game_usage: "게임 이용 문의" },
  typeLabels: { bug_report: "버그·오류 신고" },
};

function makeInquiry(overrides: Partial<InquiryRow> = {}): InquiryRow {
  return {
    id: "inq-1",
    inquiryNo: "R-20260723-0005",
    gameId: "game-1",
    groupKey: "game_usage",
    typeKey: "bug_report",
    gameAccount: "player1",
    companyName: null,
    replyEmail: "user@example.com",
    title: "자동전투 3배속 추가해주세요",
    content: "본문",
    status: "new",
    priority: "normal",
    meta: {},
    replyContent: null,
    repliedAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("InquiryHeader", () => {
  it("renders the inquiry number, title, and Korean category labels", () => {
    render(<InquiryHeader inquiry={makeInquiry()} labels={labels} />);
    expect(screen.getByText("R-20260723-0005")).toBeInTheDocument();
    expect(screen.getByText("자동전투 3배속 추가해주세요")).toBeInTheDocument();
    expect(screen.getByText("게임 이용 문의")).toBeInTheDocument();
    expect(screen.getByText("버그·오류 신고")).toBeInTheDocument();
  });

  it("shows an em dash when the inquiry has no number yet", () => {
    render(<InquiryHeader inquiry={makeInquiry({ inquiryNo: null })} labels={labels} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("falls back to raw keys when a label is missing", () => {
    render(
      <InquiryHeader inquiry={makeInquiry()} labels={{ groupLabels: {}, typeLabels: {} }} />
    );
    expect(screen.getByText("game_usage")).toBeInTheDocument();
    expect(screen.getByText("bug_report")).toBeInTheDocument();
  });

  it("shows the elapsed time as minutes for a fresh inquiry", () => {
    render(<InquiryHeader inquiry={makeInquiry()} labels={labels} />);
    expect(screen.getByText(/경과 0분/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/InquiryHeader.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/inquiries/InquiryHeader"`

- [ ] **Step 3: 구현**

`components/inquiries/InquiryHeader.tsx`:

```tsx
import type { InquiryRow } from "@/lib/inquiries";
import type { CategoryLabelMaps } from "@/lib/categories";
import StatusBadge from "@/components/ui/StatusBadge";
import { formatElapsed, formatReceivedAt } from "@/lib/format";

export default function InquiryHeader({
  inquiry,
  labels,
}: {
  inquiry: InquiryRow;
  labels: CategoryLabelMaps;
}) {
  return (
    <header className="flex flex-col gap-2">
      <h1 className="text-xl font-bold flex items-baseline gap-3">
        <span className="font-mono text-base text-muted">{inquiry.inquiryNo ?? "—"}</span>
        <span>{inquiry.title}</span>
      </h1>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        <StatusBadge status={inquiry.status} />
        <span>{labels.groupLabels[inquiry.groupKey] ?? inquiry.groupKey}</span>
        <span>{labels.typeLabels[inquiry.typeKey] ?? inquiry.typeKey}</span>
        <span>
          접수 {formatReceivedAt(inquiry.createdAt)} · 경과 {formatElapsed(inquiry.createdAt)}
        </span>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/components/InquiryHeader.test.tsx`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add components/inquiries/InquiryHeader.tsx tests/components/InquiryHeader.test.tsx
git commit -m "feat: add InquiryHeader with inquiry number and elapsed time"
```

---

### Task 7: `InquiryMetaCard` 컴포넌트

**Files:**
- Create: `components/inquiries/InquiryMetaCard.tsx`
- Test: `tests/components/InquiryMetaCard.test.tsx`

**Interfaces:**
- Consumes: `InquiryRow` (Task 3), `metaEntries` · `formatReceivedAt` (Task 2)
- Produces: `<InquiryMetaCard inquiry={InquiryRow} />`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/components/InquiryMetaCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import InquiryMetaCard from "@/components/inquiries/InquiryMetaCard";
import type { InquiryRow } from "@/lib/inquiries";

function makeInquiry(overrides: Partial<InquiryRow> = {}): InquiryRow {
  return {
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
    meta: {},
    replyContent: null,
    repliedAt: null,
    createdAt: "2026-07-23T13:55:00.000Z",
    ...overrides,
  };
}

describe("InquiryMetaCard", () => {
  it("renders the fixed fields that have values", () => {
    render(<InquiryMetaCard inquiry={makeInquiry()} />);
    expect(screen.getByText("접수 정보")).toBeInTheDocument();
    expect(screen.getByText("게임 계정")).toBeInTheDocument();
    expect(screen.getByText("player1")).toBeInTheDocument();
    expect(screen.getByText("user@example.com")).toBeInTheDocument();
  });

  it("omits fixed fields that are empty", () => {
    render(<InquiryMetaCard inquiry={makeInquiry({ gameAccount: null, companyName: null })} />);
    expect(screen.queryByText("게임 계정")).not.toBeInTheDocument();
    expect(screen.queryByText("회사명")).not.toBeInTheDocument();
  });

  it("renders meta values with Korean labels", () => {
    render(
      <InquiryMetaCard
        inquiry={makeInquiry({ meta: { uid: "10024871", device: "SM-S938N", custom_field: "x" } })}
      />
    );
    expect(screen.getByText("UID")).toBeInTheDocument();
    expect(screen.getByText("10024871")).toBeInTheDocument();
    expect(screen.getByText("기기")).toBeInTheDocument();
    expect(screen.getByText("custom_field")).toBeInTheDocument();
  });

  it("renders nothing extra when meta is empty", () => {
    render(<InquiryMetaCard inquiry={makeInquiry({ meta: {} })} />);
    expect(screen.queryByText("UID")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/InquiryMetaCard.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/inquiries/InquiryMetaCard"`

- [ ] **Step 3: 구현**

`components/inquiries/InquiryMetaCard.tsx`:

```tsx
import type { InquiryRow } from "@/lib/inquiries";
import { formatReceivedAt, metaEntries } from "@/lib/format";

export default function InquiryMetaCard({ inquiry }: { inquiry: InquiryRow }) {
  const fixed: Array<{ label: string; value: string | null }> = [
    { label: "게임 계정", value: inquiry.gameAccount },
    { label: "회사명", value: inquiry.companyName },
    { label: "회신 이메일", value: inquiry.replyEmail },
    { label: "접수 시각", value: formatReceivedAt(inquiry.createdAt) },
  ];

  const rows = [
    ...fixed
      .filter((row) => row.value && row.value.trim() !== "")
      .map((row) => ({ key: row.label, label: row.label, value: row.value as string })),
    ...metaEntries(inquiry.meta),
  ];

  return (
    <section className="bg-panel border border-line rounded-2xl p-4">
      <h2 className="font-semibold mb-3">접수 정보</h2>
      <dl className="flex flex-col gap-2 text-sm">
        {rows.map((row) => (
          <div key={row.key} className="flex items-start justify-between gap-3">
            <dt className="text-muted shrink-0">{row.label}</dt>
            <dd className="text-right break-all">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/components/InquiryMetaCard.test.tsx`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add components/inquiries/InquiryMetaCard.tsx tests/components/InquiryMetaCard.test.tsx
git commit -m "feat: add InquiryMetaCard rendering fixed fields and meta"
```

---

### Task 8: `InquiryDetail` 슬림화 + 상세 페이지 레이아웃 조립

**Files:**
- Modify: `components/inquiries/InquiryDetail.tsx`
- Modify: `app/(admin)/inquiries/[id]/page.tsx`
- Test: `tests/components/InquiryDetail.test.tsx`

**Interfaces:**
- Consumes: `InquiryHeader` (Task 6), `InquiryMetaCard` (Task 7), `PrioritySelect` (Task 5), `listCategoryLabels(supabase, gameId)` from `@/lib/categories`
- Produces: `<InquiryDetail inquiry={InquiryRow} attachments={AttachmentWithUrl[]} />` — 이제 헤더와 `dl`을 렌더하지 않고 문의 내용 · 첨부 · 보낸 답변 카드만 담당한다

- [ ] **Step 1: 기존 테스트를 새 책임에 맞게 수정**

`tests/components/InquiryDetail.test.tsx`를 통째로 아래 내용으로 교체한다. 제목·회신 이메일 단언은 `InquiryHeader` / `InquiryMetaCard` 테스트로 이미 옮겨졌다.

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import InquiryDetail from "@/components/inquiries/InquiryDetail";
import type { InquiryRow } from "@/lib/inquiries";

const inquiry: InquiryRow = {
  id: "inq-1",
  inquiryNo: "R-20260101-0001",
  gameId: "game-1",
  groupKey: "game_usage",
  typeKey: "bug_report",
  gameAccount: "player1",
  companyName: null,
  replyEmail: "user@example.com",
  title: "버그 제보",
  content: "화면이 멈춰요",
  status: "new",
  priority: "normal",
  meta: {},
  replyContent: null,
  repliedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("InquiryDetail", () => {
  it("renders the inquiry content under a 문의 내용 heading", () => {
    render(<InquiryDetail inquiry={inquiry} attachments={[]} />);
    expect(screen.getByText("문의 내용")).toBeInTheDocument();
    expect(screen.getByText("화면이 멈춰요")).toBeInTheDocument();
  });

  it("does not render the title or reply email (moved to header and meta card)", () => {
    render(<InquiryDetail inquiry={inquiry} attachments={[]} />);
    expect(screen.queryByText("버그 제보")).not.toBeInTheDocument();
    expect(screen.queryByText("user@example.com")).not.toBeInTheDocument();
  });

  it("hides the attachment card when there are no attachments", () => {
    render(<InquiryDetail inquiry={inquiry} attachments={[]} />);
    expect(screen.queryByText("첨부파일")).not.toBeInTheDocument();
  });

  it("renders a link per attachment", () => {
    render(
      <InquiryDetail
        inquiry={inquiry}
        attachments={[{ id: "att-1", fileName: "screenshot.png", signedUrl: "https://signed.example/x" }]}
      />
    );
    expect(screen.getByRole("link", { name: "screenshot.png" })).toHaveAttribute(
      "href",
      "https://signed.example/x"
    );
  });

  it("shows a fallback when an attachment URL could not be signed", () => {
    render(
      <InquiryDetail
        inquiry={inquiry}
        attachments={[{ id: "att-1", fileName: "screenshot.png", signedUrl: null }]}
      />
    );
    expect(screen.getByText("screenshot.png (링크 생성 실패)")).toBeInTheDocument();
  });

  it("shows the previous reply when the inquiry is already resolved", () => {
    render(
      <InquiryDetail
        inquiry={{
          ...inquiry,
          status: "resolved",
          replyContent: "확인 후 조치했습니다",
          repliedAt: "2026-01-02T00:00:00.000Z",
        }}
        attachments={[]}
      />
    );
    expect(screen.getByText("확인 후 조치했습니다")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/InquiryDetail.test.tsx`
Expected: FAIL — `Unable to find an element with the text: 문의 내용`, 그리고 제목·이메일 부재 단언 실패

- [ ] **Step 3: `InquiryDetail` 구현**

`components/inquiries/InquiryDetail.tsx` 전체를 교체한다:

```tsx
import type { InquiryRow, AttachmentWithUrl } from "@/lib/inquiries";
import { formatReceivedAt } from "@/lib/format";

const CARD = "bg-panel border border-line rounded-2xl p-4";

export default function InquiryDetail({
  inquiry,
  attachments,
}: {
  inquiry: InquiryRow;
  attachments: AttachmentWithUrl[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <section className={CARD}>
        <h2 className="font-semibold mb-3">문의 내용</h2>
        <p className="whitespace-pre-wrap">{inquiry.content}</p>
      </section>

      {attachments.length > 0 && (
        <section className={CARD}>
          <h2 className="font-semibold mb-3">첨부파일</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {attachments.map((attachment) => (
              <li key={attachment.id}>
                {attachment.signedUrl ? (
                  <a href={attachment.signedUrl} target="_blank" rel="noreferrer" className="text-accent underline">
                    {attachment.fileName}
                  </a>
                ) : (
                  <span className="text-muted">{attachment.fileName} (링크 생성 실패)</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {inquiry.replyContent && (
        <section className={CARD}>
          <h2 className="font-semibold mb-3">
            보낸 답변
            {inquiry.repliedAt && (
              <span className="ml-2 text-sm font-normal text-muted">{formatReceivedAt(inquiry.repliedAt)}</span>
            )}
          </h2>
          <p className="whitespace-pre-wrap">{inquiry.replyContent}</p>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/components/InquiryDetail.test.tsx`
Expected: PASS

- [ ] **Step 5: 상세 페이지 레이아웃 조립**

`app/(admin)/inquiries/[id]/page.tsx` 전체를 교체한다:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { getInquiryById, listAttachmentSignedUrls } from "@/lib/inquiries";
import { getAccountHistory } from "@/lib/account-history";
import { listCategoryLabels } from "@/lib/categories";
import InquiryHeader from "@/components/inquiries/InquiryHeader";
import InquiryDetail from "@/components/inquiries/InquiryDetail";
import InquiryMetaCard from "@/components/inquiries/InquiryMetaCard";
import StatusSelect from "@/components/inquiries/StatusSelect";
import PrioritySelect from "@/components/inquiries/PrioritySelect";
import ReplyForm from "@/components/inquiries/ReplyForm";
import AccountHistoryPanel from "@/components/inquiries/AccountHistoryPanel";

export const dynamic = "force-dynamic";

export default async function InquiryDetailPage({ params }: { params: { id: string } }) {
  const supabase = getSupabaseServerClient();
  const inquiry = await getInquiryById(supabase, params.id);

  if (!inquiry) {
    notFound();
  }

  const [attachments, history, labels] = await Promise.all([
    listAttachmentSignedUrls(supabase, inquiry.id),
    getAccountHistory(supabase, inquiry.gameId, inquiry.gameAccount, inquiry.id),
    listCategoryLabels(supabase, inquiry.gameId),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/games/${inquiry.gameId}/inquiries`}
        className="text-sm text-muted hover:text-ink transition-colors"
      >
        ← 목록
      </Link>

      <InquiryHeader inquiry={inquiry} labels={labels} />

      <div className="grid grid-cols-[2fr_1fr] gap-6 items-start">
        <div className="flex flex-col gap-4">
          <InquiryDetail inquiry={inquiry} attachments={attachments} />
          <section className="bg-panel border border-line rounded-2xl p-4">
            <h2 className="font-semibold mb-3">답변</h2>
            <ReplyForm inquiryId={inquiry.id} />
          </section>
        </div>

        <div className="flex flex-col gap-4">
          <section className="bg-panel border border-line rounded-2xl p-4">
            <h2 className="font-semibold mb-3">처리</h2>
            <div className="flex flex-col gap-3">
              <StatusSelect inquiryId={inquiry.id} currentStatus={inquiry.status} />
              <PrioritySelect inquiryId={inquiry.id} currentPriority={inquiry.priority} />
            </div>
          </section>
          <InquiryMetaCard inquiry={inquiry} />
          <AccountHistoryPanel history={history} gameAccount={inquiry.gameAccount} />
        </div>
      </div>
    </div>
  );
}
```

`StatusSelect`의 라벨이 `<span>상태</span>`로 좌측 정렬되어 있어 `PrioritySelect`와 줄이 어긋난다. `components/inquiries/StatusSelect.tsx`의 `label`과 `select` className만 `PrioritySelect`와 같게 맞춘다 — 동작은 건드리지 않는다:

```tsx
      <label className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted">상태</span>
        <select
          value={status}
          onChange={(e) => handleChange(e.target.value as InquiryStatus)}
          className="bg-panel border border-line rounded-lg px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
        >
```

- [ ] **Step 6: 타입 체크와 전체 테스트**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 타입 에러 없음, 모든 테스트 PASS (`StatusSelect.test.tsx`는 라벨 텍스트가 그대로이므로 계속 통과해야 한다)

- [ ] **Step 7: 커밋**

```bash
git add components/inquiries/InquiryDetail.tsx components/inquiries/StatusSelect.tsx "app/(admin)/inquiries/[id]/page.tsx" tests/components/InquiryDetail.test.tsx
git commit -m "feat: restructure inquiry detail into header, content cards, and sidebar"
```

---

### Task 9: 목록 화면 — 접수번호 컬럼과 경과 표기

**Files:**
- Modify: `components/inquiries/InquiryMailbox.tsx`
- Test: `tests/components/InquiryMailbox.test.tsx`

**Interfaces:**
- Consumes: `formatElapsed` · `formatReceivedAt` (Task 2), `InquiryRow.inquiryNo` (Task 3)
- Produces: 없음 (최종 화면)

`InquiryMailbox.tsx`에 있던 `formatReceivedAt`과 `elapsedDays`의 로컬 정의를 지우고 `@/lib/format`에서 가져온다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/components/InquiryMailbox.test.tsx`의 기존 테스트는 그대로 두고, `describe("InquiryMailbox", ...)` 블록 안 마지막 `it` 뒤에 다음 네 개를 추가한다:

```tsx
  it("shows the inquiry number instead of a UUID fragment", () => {
    render(
      <InquiryMailbox inquiries={[makeInquiry({ inquiryNo: "R-20260723-0005" })]} labels={labels} />
    );
    expect(screen.getByText("R-20260723-0005")).toBeInTheDocument();
    expect(screen.queryByText("aaaabbbb")).not.toBeInTheDocument();
  });

  it("shows an em dash when the inquiry has no number", () => {
    render(<InquiryMailbox inquiries={[makeInquiry({ inquiryNo: null })]} labels={labels} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("filters by inquiry number as well as title", async () => {
    render(
      <InquiryMailbox
        inquiries={[
          makeInquiry({
            id: "11111111-0000-0000-0000-000000000000",
            inquiryNo: "R-20260723-0005",
            title: "결제 오류",
          }),
          makeInquiry({
            id: "22222222-0000-0000-0000-000000000000",
            inquiryNo: "R-20260724-0001",
            title: "계정 복구 요청",
          }),
        ]}
        labels={labels}
      />
    );

    await userEvent.type(screen.getByLabelText("검색"), "0005");

    expect(screen.getByText("결제 오류")).toBeInTheDocument();
    expect(screen.queryByText("계정 복구 요청")).not.toBeInTheDocument();
  });

  it("shows elapsed time in minutes for a fresh inquiry", () => {
    render(<InquiryMailbox inquiries={[makeInquiry({})]} labels={labels} />);
    expect(screen.getByText("0분")).toBeInTheDocument();
  });
```

기존 "filters by title search" 테스트의 `screen.getByLabelText("제목 검색")`도 `screen.getByLabelText("검색")`으로 바꾼다 — 검색이 제목만 훑지 않게 되므로 라벨을 넓힌다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/InquiryMailbox.test.tsx`
Expected: FAIL — `Unable to find a label with the text of: 검색`, `R-20260723-0005` 미발견

- [ ] **Step 3: 구현**

`components/inquiries/InquiryMailbox.tsx`를 다음과 같이 수정한다.

1. 파일 상단의 로컬 `formatReceivedAt`, `elapsedDays` 함수 정의를 **삭제**하고 import를 추가한다:

```tsx
import { formatElapsed, formatReceivedAt } from "@/lib/format";
```

2. 검색 필터가 접수번호도 훑도록 `filtered`의 `useMemo` 안 키워드 조건을 바꾼다:

```tsx
      if (keyword) {
        const haystack = `${inquiry.title} ${inquiry.inquiryNo ?? ""}`.toLowerCase();
        if (!haystack.includes(keyword)) return false;
      }
```

3. 검색 입력의 placeholder와 aria-label을 바꾼다:

```tsx
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="제목 · 접수번호 검색"
          className={`${selectClass} w-44`}
          aria-label="검색"
        />
```

4. 행 렌더에서 `const days = elapsedDays(inquiry.createdAt);`를 지우고, 경과 칸의 강조 조건은 24시간 이상 미해결 기준으로 바꾼다. 행 렌더 부분을 다음으로 교체한다:

```tsx
              {filtered.map((inquiry) => {
                const elapsed = formatElapsed(inquiry.createdAt);
                const stale = inquiry.status !== "resolved" && elapsed.endsWith("일");
                return (
                  <tr
                    key={inquiry.id}
                    onClick={() => router.push(`/inquiries/${inquiry.id}`)}
                    className={`border-b border-line last:border-b-0 cursor-pointer hover:bg-ground/60 transition-colors ${
                      inquiry.status === "new" ? "border-l-2 border-l-accent" : "border-l-2 border-l-transparent"
                    }`}
                  >
                    <td className="px-4 py-2.5 font-mono text-xs text-muted">{inquiry.inquiryNo ?? "—"}</td>
                    <td className="px-4 py-2.5 text-muted">{labels.groupLabels[inquiry.groupKey] ?? inquiry.groupKey}</td>
                    <td className="px-4 py-2.5 text-muted">{labels.typeLabels[inquiry.typeKey] ?? inquiry.typeKey}</td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/inquiries/${inquiry.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-ink font-medium hover:text-accent transition-colors"
                      >
                        {inquiry.title}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted">{inquiry.gameAccount ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={inquiry.status} />
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right font-mono text-xs ${
                        stale ? "text-accent font-semibold" : "text-muted"
                      }`}
                    >
                      {elapsed}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted">{formatReceivedAt(inquiry.createdAt)}</td>
                  </tr>
                );
              })}
```

> `uppercase` 클래스는 접수번호 컬럼에서 뺀다 — 접수번호는 이미 대문자이고, `—` 폴백에 적용될 이유가 없다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/components/InquiryMailbox.test.tsx`
Expected: PASS (기존 테스트 포함 전부)

- [ ] **Step 5: 커밋**

```bash
git add components/inquiries/InquiryMailbox.tsx tests/components/InquiryMailbox.test.tsx
git commit -m "feat: show inquiry number and precise elapsed time in the mailbox"
```

---

### Task 10: 회신 메일 제목에 접수번호 삽입

**Files:**
- Modify: `app/api/inquiries/[id]/reply/route.ts`
- Test: `tests/api/inquiry-reply.test.ts`

**Interfaces:**
- Consumes: `inquiries.inquiry_no` (Task 1)
- Produces: 없음 (최종 동작)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/api/inquiry-reply.test.ts`를 수정한다.

먼저 `mockFetchInquiry`의 시그니처에 `inquiry_no`를 추가한다:

```ts
  function mockFetchInquiry(
    inquiry: { id: string; reply_email: string; title: string; inquiry_no?: string | null } | null,
    error: { message: string } | null = null
  ) {
```

기존 "sends the email and marks the inquiry resolved on success" 테스트에서 픽스처와 기대 제목을 바꾼다:

```ts
    const { update, eqUpdate } = mockFetchInquiry({
      id: "inq-1",
      reply_email: "user@example.com",
      title: "제목",
      inquiry_no: "R-20260723-0005",
    });
    vi.mocked(gmailModule.sendReplyEmail).mockResolvedValue(undefined);

    const response = await POST(jsonRequest({ replyContent: "답변 내용입니다" }), { params: { id: "inq-1" } });
    const json = await response.json();

    expect(gmailModule.sendReplyEmail).toHaveBeenCalledWith({
      to: "user@example.com",
      subject: "[R-20260723-0005] Re: 제목",
      body: "답변 내용입니다",
    });
```

그리고 `describe("POST /api/inquiries/[id]/reply", ...)` 블록 안 마지막 `it` 뒤에 폴백 테스트를 추가한다:

```ts
  it("falls back to a bare subject when the inquiry has no number", async () => {
    mockFetchInquiry({ id: "inq-1", reply_email: "user@example.com", title: "제목", inquiry_no: null });
    vi.mocked(gmailModule.sendReplyEmail).mockResolvedValue(undefined);

    await POST(jsonRequest({ replyContent: "답변" }), { params: { id: "inq-1" } });

    expect(gmailModule.sendReplyEmail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Re: 제목" })
    );
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/api/inquiry-reply.test.ts`
Expected: FAIL — 실제 subject가 `"Re: 제목"`인데 `"[R-20260723-0005] Re: 제목"`을 기대

- [ ] **Step 3: 구현**

`app/api/inquiries/[id]/reply/route.ts`에서 select에 `inquiry_no`를 추가하고 제목을 조립한다.

```ts
  const { data: inquiry, error: fetchError } = await supabase
    .from("inquiries")
    .select("id, reply_email, title, inquiry_no")
    .eq("id", params.id)
    .single();

  if (fetchError || !inquiry) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }

  // 접수번호를 제목에 넣어 사용자가 메일로 다시 문의해도 건을 특정할 수 있게 한다.
  const subject = inquiry.inquiry_no ? `[${inquiry.inquiry_no}] Re: ${inquiry.title}` : `Re: ${inquiry.title}`;

  try {
    await sendReplyEmail({
      to: inquiry.reply_email,
      subject,
      body: parsed.data.replyContent,
    });
  } catch {
    return NextResponse.json({ success: false, error: "send_failed" }, { status: 500 });
  }
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/api/inquiry-reply.test.ts`
Expected: PASS

- [ ] **Step 5: 전체 검증**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 타입 에러 없음, 모든 테스트 PASS

- [ ] **Step 6: 커밋**

```bash
git add app/api/inquiries/\[id\]/reply/route.ts tests/api/inquiry-reply.test.ts
git commit -m "feat: include inquiry number in reply email subject"
```

---

## 완료 후 보고 항목

구현이 끝나면 다음을 그대로 보고한다. 자동 검증하지 않은 항목을 검증했다고 쓰지 마라.

- `npx tsc --noEmit` 결과
- `npx vitest run` 결과 (통과/실패 수)
- Task 1의 수동 검증 4항목 — **사람이 Supabase에 마이그레이션을 적용한 뒤** 확인해야 하며, 코드만으로는 검증되지 않는다
- `.env`에 Gmail 환경변수가 없으면 답변 발송은 여전히 동작하지 않는다는 사실
