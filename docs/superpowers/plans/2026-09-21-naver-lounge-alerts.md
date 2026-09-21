# 네이버 게임 라운지 새 글·댓글 알림 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 게임별로 연결한 네이버 게임 라운지에 유저가 글·댓글을 쓰면 5분 안에 관리자 페이지(보기 열 건수·목록·레일 배지)와 Slack으로 알리고, 클릭하면 라운지의 그 글이 새 탭으로 열린다.

**Architecture:** 회신 자동 동기화와 같은 모양이다. `pg_cron`이 5분마다 `/api/lounge/sync`를 부르고, `lib/lounge-sync.ts`가 라운지가 연결된 게임마다 네이버 내부 API(`lib/naver-lounge.ts`)로 최신 글 50건과 댓글 수가 바뀐 글의 댓글을 읽어 `lounge_items` 표에 넣는다. 유저가 쓴 새 항목만 안 읽음(`read_at is null`)이 되고 Slack으로 나간다.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase(Postgres, pg_cron, pg_net), zod, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-21-naver-lounge-alerts-design.md`

## Global Constraints

- 관리자 UI 문구는 한국어 전용.
- 알림 대상은 `userRoleCode === "common_user"`인 글·댓글·답글뿐. GM·운영자 항목은 저장하되 읽음으로 넣는다.
- 부가 작업 실패(라운지 연결, Slack, 건수 조회)는 핵심 흐름을 막지 않는다 — 경고만.
- 비밀값은 코드·문서에 쓰지 않는다. cron 인증은 기존 `x-webhook-secret`(`lib/webhook-secret.ts`의 `isWebhookAuthorized`)과 Vault의 `inquiry_webhook_secret`을 그대로 쓴다.
- 마이그레이션은 재실행 안전(`if not exists`, `unschedule ... where exists`)하게 쓰고 번호는 `0024`.
- 네이버 호출은 `Referer: https://game.naver.com/`와 브라우저 `User-Agent`를 붙이고 10초 타임아웃.
- 테스트 실행: `npx vitest run <파일>`. 커밋 메시지는 한국어 `feat:`/`docs:` 말머리, 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## File Structure

| 파일 | 책임 |
| --- | --- |
| `supabase/migrations/0024_naver_lounge.sql` | 열·표·cron 잡 |
| `lib/naver-lounge.ts` | 네이버 API 호출·파싱(외부 API를 아는 유일한 파일) |
| `lib/lounge-items.ts` | `lounge_items` 읽기·건수·읽음 처리 |
| `lib/lounge-sync.ts` | 게임별 동기화 |
| `lib/lounge-connect.ts` | 라운지 연결·해제(게임 추가와 PATCH가 공유) |
| `lib/slack.ts` | `buildLoungeSlackMessage` 추가 |
| `app/api/lounge/sync/route.ts` | cron 진입점 + Slack |
| `app/api/games/[gameId]/lounge/route.ts` | PATCH 연결 |
| `app/api/games/[gameId]/lounge/read-all/route.ts`, `app/api/lounge/items/[id]/read/route.ts` | 읽음 처리 |
| `components/inbox/LoungeConnectDialog.tsx` | 연결 대화상자 |
| `components/lounge/LoungeItemList.tsx` | 목록(클라이언트) |
| `app/(admin)/games/[gameId]/lounge/page.tsx` | 목록 페이지 |
| 수정: `lib/categories.ts`, `lib/game-schema.ts`, `app/api/games/route.ts`, `components/games/GameForm.tsx`, `components/inbox/InboxNav.tsx`, `components/inbox/InboxShell.tsx`, `lib/inbox-page.ts`, `components/layout/GameRail.tsx`, `app/(admin)/layout.tsx`, `CLAUDE.md` | |

---

### Task 1: 마이그레이션과 GameRow

**Files:**
- Create: `supabase/migrations/0024_naver_lounge.sql`
- Modify: `lib/categories.ts` (`GameRow`, `mapGameRow`)

**Interfaces:**
- Produces: `GameRow.naverLoungeId?: string | null`; 표 `lounge_items`; 열 `games.naver_lounge_id`, `games.lounge_synced_at`.

- [ ] **Step 1: 마이그레이션 작성**

```sql
-- 네이버 게임 라운지 새 글·댓글 알림.
-- 설계: docs/superpowers/specs/2026-09-21-naver-lounge-alerts-design.md
-- 재실행 안전. Vault의 inquiry_webhook_secret은 자동 답변 설정 때 넣은 것을 그대로 쓴다.

alter table games add column if not exists naver_lounge_id text;
alter table games add column if not exists lounge_synced_at timestamptz;

create table if not exists lounge_items (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  kind text not null check (kind in ('post', 'comment')),
  naver_id bigint not null,
  feed_id bigint not null,
  title text not null,
  body text not null default '',
  board_name text,
  nickname text,
  is_user boolean not null,
  url text not null,
  comment_count integer,
  posted_at timestamptz not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (game_id, kind, naver_id)
);

create index if not exists lounge_items_unread_idx on lounge_items (game_id) where read_at is null;
create index if not exists lounge_items_game_posted_idx on lounge_items (game_id, posted_at desc);

-- 정책 없음: service_role만 읽고 쓴다.
alter table lounge_items enable row level security;

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('lounge-sync-run')
  where exists (select 1 from cron.job where jobname = 'lounge-sync-run');

select cron.schedule(
  'lounge-sync-run',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://admin.theplayplus.com/api/lounge/sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'inquiry_webhook_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
```

`games`의 anon 열 단위 grant(0018)는 건드리지 않는다 — 새 열은 anon에 열리지 않는다.

- [ ] **Step 2: `GameRow`에 필드 추가** (`lib/categories.ts`)

`GameRow`에 한 줄 추가:

```ts
  createdAt: string;
  /** 연결된 네이버 게임 라운지 ID. 없으면 라운지 알림을 쓰지 않는 게임. */
  naverLoungeId?: string | null;
```

`mapGameRow`의 인자 타입에 `naver_lounge_id?: string | null;`을, 반환 객체에 `naverLoungeId: row.naver_lounge_id ?? null,`을 추가한다.

- [ ] **Step 3: 기존 테스트 확인**

Run: `npx vitest run tests/lib/categories.test.ts`
Expected: PASS. `toEqual`로 GameRow 전체를 비교하던 테스트가 깨지면 기대값에 `naverLoungeId: null`을 더한다.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0024_naver_lounge.sql lib/categories.ts tests/lib/categories.test.ts
git commit -m "feat: 네이버 라운지 알림용 표·열·cron 마이그레이션과 GameRow 필드"
```

---

### Task 2: 네이버 읽기 (`lib/naver-lounge.ts`)

**Files:**
- Create: `lib/naver-lounge.ts`
- Test: `tests/lib/naver-lounge.test.ts`

**Interfaces:**
- Produces:

```ts
export interface LoungePost { feedId: number; title: string; bodyText: string; boardName: string | null; nickname: string | null; isUser: boolean; postedAt: string; url: string; commentCount: number }
export interface LoungeComment { commentId: number; feedId: number; bodyText: string; nickname: string | null; isUser: boolean; postedAt: string }
export function parseLoungeId(input: string): string | null
export function fetchLoungePosts(loungeId: string): Promise<LoungePost[]>
export function fetchLoungeComments(loungeId: string, feedId: number): Promise<LoungeComment[]>
```

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { parseLoungeId, fetchLoungePosts, fetchLoungeComments } from "@/lib/naver-lounge";

function stubFetch(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const contents = JSON.stringify({
  document: {
    components: [
      { "@ctype": "sticker" },
      { "@ctype": "text", value: [
        { "@ctype": "paragraph", nodes: [{ "@ctype": "textNode", value: "첫 줄" }, { "@ctype": "textNode", value: "입니다" }] },
        { "@ctype": "paragraph", nodes: [{ "@ctype": "textNode", value: "둘째 줄" }] },
      ] },
    ],
  },
});

const feedResponse = {
  code: 200,
  content: {
    feeds: [
      {
        feed: { feedId: 8212525, title: "&#x1f430; 다른 게임 &amp; 맞죠?", contents, createdDate: "20260919215348" },
        user: { nickname: "게임달고나", userRoleCode: "common_user" },
        comment: { totalCount: 2 },
        feedLink: { pc: "https://game.naver.com/lounge/L1/board/detail/8212525" },
        board: { boardName: "창업자들의 토크" },
      },
      {
        feed: { feedId: 8207656, title: "[안내] 오픈안내", contents: "깨진 JSON", createdDate: "20260918174755" },
        user: { nickname: "토크", userRoleCode: "game_manager" },
        comment: { totalCount: 0 },
        feedLink: { pc: "https://game.naver.com/lounge/L1/board/detail/8207656" },
        board: null,
      },
    ],
  },
};

afterEach(() => vi.unstubAllGlobals());

describe("parseLoungeId", () => {
  it("pulls the id out of pc and mobile lounge urls", () => {
    expect(parseLoungeId("https://game.naver.com/lounge/Tukiers_God_Tier_Life_Idle_Tycoon/home")).toBe("Tukiers_God_Tier_Life_Idle_Tycoon");
    expect(parseLoungeId("https://m.game.naver.com/lounge/Abc_123/board/detail/1?x=1")).toBe("Abc_123");
  });
  it("accepts a bare id and trims it", () => {
    expect(parseLoungeId("  Abc_123 ")).toBe("Abc_123");
  });
  it("rejects other hosts, other paths, and junk", () => {
    expect(parseLoungeId("https://example.com/lounge/Abc/home")).toBeNull();
    expect(parseLoungeId("https://game.naver.com/esports")).toBeNull();
    expect(parseLoungeId("한글 아이디")).toBeNull();
    expect(parseLoungeId("")).toBeNull();
  });
});

describe("fetchLoungePosts", () => {
  it("maps the feed response", async () => {
    const fetchMock = stubFetch(feedResponse);
    const posts = await fetchLoungePosts("L1");
    expect(fetchMock.mock.calls[0][0]).toContain("/community/lounge/L1/feed?");
    expect(fetchMock.mock.calls[0][0]).toContain("limit=50");
    expect(fetchMock.mock.calls[0][1].headers.Referer).toBe("https://game.naver.com/");
    expect(posts[0]).toEqual({
      feedId: 8212525,
      title: "🐰 다른 게임 & 맞죠?",
      bodyText: "첫 줄입니다\n둘째 줄",
      boardName: "창업자들의 토크",
      nickname: "게임달고나",
      isUser: true,
      postedAt: "2026-09-19T12:53:48.000Z",
      url: "https://game.naver.com/lounge/L1/board/detail/8212525",
      commentCount: 2,
    });
    // 본문 JSON이 깨져도 글은 살린다. GM 글은 isUser=false.
    expect(posts[1]).toMatchObject({ feedId: 8207656, bodyText: "", isUser: false, boardName: null, commentCount: 0 });
  });
  it("throws on a non-ok response and on an unexpected shape", async () => {
    stubFetch({}, false);
    await expect(fetchLoungePosts("L1")).rejects.toThrow();
    stubFetch({ content: { feeds: [{ feed: {} }] } });
    await expect(fetchLoungePosts("L1")).rejects.toThrow();
  });
});

describe("fetchLoungeComments", () => {
  const comment = (over: Record<string, unknown>, user: Record<string, unknown>, replies: unknown[] = []) => ({
    comment: { commentId: 1, content: "내용", createdDate: "20260921030329", secret: false, deleted: false, attaches: null, ...over },
    user: { userNickname: "유저", userRoleCode: "common_user", ...user },
    replyComments: replies,
  });

  it("flattens replies and handles secret, deleted, and sticker-only comments", async () => {
    const fetchMock = stubFetch({
      content: {
        comments: {
          data: [
            comment({ commentId: 10, content: "GM 답변" }, { userNickname: "토크", userRoleCode: "game_manager" }, [
              comment({ commentId: 11, content: "", attaches: [{ attachType: "STICKER" }] }, {}),
            ]),
            comment({ commentId: 12, secret: true, content: "숨김" }, {}),
            comment({ commentId: 13, deleted: true }, {}),
          ],
        },
      },
    });
    const comments = await fetchLoungeComments("L1", 8212525);
    expect(fetchMock.mock.calls[0][0]).toContain("/type/FEED/id/8212525/comments?");
    expect(fetchMock.mock.calls[0][0]).toContain("originalLoungeId=L1");
    expect(comments).toEqual([
      { commentId: 10, feedId: 8212525, bodyText: "GM 답변", nickname: "토크", isUser: false, postedAt: "2026-09-20T18:03:29.000Z" },
      { commentId: 11, feedId: 8212525, bodyText: "(스티커·이미지)", nickname: "유저", isUser: true, postedAt: "2026-09-20T18:03:29.000Z" },
      { commentId: 12, feedId: 8212525, bodyText: "(비밀 댓글)", nickname: "유저", isUser: true, postedAt: "2026-09-20T18:03:29.000Z" },
    ]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/lib/naver-lounge.test.ts`
Expected: FAIL — `@/lib/naver-lounge`를 찾을 수 없음.

- [ ] **Step 3: 구현**

```ts
import { z } from "zod";

/**
 * 네이버 게임 라운지 읽기. 라운지 웹이 쓰는 내부 API를 로그인 없이 부른다(2026-09-21 실측).
 * 공식 API가 아니라 예고 없이 바뀔 수 있으므로, 응답 모양이 다르면 조용히 넘기지 않고 던져서
 * 동기화가 fetch_failed로 기록하게 한다. 외부 API를 아는 파일은 여기 하나다.
 */

const FEED_BASE = "https://comm-api.game.naver.com/nng_main/v1/community/lounge";
const COMMENT_BASE = "https://apis.naver.com/nng_main/nng_comment_api/v1";
const POST_LIMIT = 50;
const COMMENT_LIMIT = 30;
const TIMEOUT_MS = 10_000;
const HEADERS = {
  Referer: "https://game.naver.com/",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
};
const USER_ROLE = "common_user";

export interface LoungePost {
  feedId: number;
  title: string;
  bodyText: string;
  boardName: string | null;
  nickname: string | null;
  isUser: boolean;
  postedAt: string;
  url: string;
  commentCount: number;
}

export interface LoungeComment {
  commentId: number;
  feedId: number;
  bodyText: string;
  nickname: string | null;
  isUser: boolean;
  postedAt: string;
}

const feedSchema = z.object({
  content: z.object({
    feeds: z.array(
      z.object({
        feed: z.object({ feedId: z.number(), title: z.string(), contents: z.string().nullish(), createdDate: z.string() }),
        user: z.object({ nickname: z.string().nullish(), userRoleCode: z.string().nullish() }).nullish(),
        comment: z.object({ totalCount: z.number() }).nullish(),
        feedLink: z.object({ pc: z.string() }),
        board: z.object({ boardName: z.string().nullish() }).nullish(),
      })
    ),
  }),
});

const commentNodeSchema = z.object({
  comment: z.object({
    commentId: z.number(),
    content: z.string().nullish(),
    createdDate: z.string(),
    secret: z.boolean().nullish(),
    deleted: z.boolean().nullish(),
    attaches: z.array(z.unknown()).nullish(),
  }),
  user: z.object({ userNickname: z.string().nullish(), userRoleCode: z.string().nullish() }).nullish(),
});
const commentsSchema = z.object({
  content: z.object({
    comments: z.object({
      data: z.array(commentNodeSchema.extend({ replyComments: z.array(commentNodeSchema).nullish() })),
    }),
  }),
});

const LOUNGE_ID = /^[A-Za-z0-9_]+$/;

/** 라운지 URL(PC·모바일) 또는 ID 문자열에서 라운지 ID를 뽑는다. */
export function parseLoungeId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (LOUNGE_ID.test(trimmed)) return trimmed;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.hostname !== "game.naver.com" && url.hostname !== "m.game.naver.com") return null;
  const match = url.pathname.match(/^\/lounge\/([A-Za-z0-9_]+)(?:\/|$)/);
  return match ? match[1] : null;
}

/** `yyyyMMddHHmmss`(KST) → ISO. */
function parseKstDate(value: string): string {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!m) throw new Error(`unexpected lounge date: ${value}`);
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00`).toISOString();
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** 제목은 이모지 등이 `&#x1f430;` 꼴로 온다. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x")) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(parseInt(body.slice(1), 10));
    return NAMED_ENTITIES[body] ?? whole;
  });
}

/** SmartEditor 문서 JSON에서 단락의 글자만 모은다. 모양을 모르면 빈 문자열. */
function extractEditorText(contents: string | null | undefined): string {
  if (!contents) return "";
  let root: unknown;
  try {
    root = JSON.parse(contents);
  } catch {
    return "";
  }
  const paragraphs: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (record["@ctype"] === "paragraph" && Array.isArray(record.nodes)) {
      paragraphs.push(record.nodes.map((n) => (n && typeof n === "object" && typeof (n as { value?: unknown }).value === "string" ? (n as { value: string }).value : "")).join(""));
      return;
    }
    Object.values(record).forEach(walk);
  };
  walk(root);
  return paragraphs.join("\n").trim();
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`naver lounge request failed: ${response.status}`);
  }
  return response.json();
}

/** 최신 글 50건. */
export async function fetchLoungePosts(loungeId: string): Promise<LoungePost[]> {
  const params = new URLSearchParams({ boardId: "0", buffFilteringYN: "N", limit: String(POST_LIMIT), offset: "0", order: "NEW" });
  const parsed = feedSchema.parse(await getJson(`${FEED_BASE}/${loungeId}/feed?${params}`));
  return parsed.content.feeds.map((entry) => ({
    feedId: entry.feed.feedId,
    title: decodeEntities(entry.feed.title),
    bodyText: extractEditorText(entry.feed.contents),
    boardName: entry.board?.boardName ?? null,
    nickname: entry.user?.nickname ?? null,
    isUser: entry.user?.userRoleCode === USER_ROLE,
    postedAt: parseKstDate(entry.feed.createdDate),
    url: entry.feedLink.pc,
    commentCount: entry.comment?.totalCount ?? 0,
  }));
}

/** 한 글의 댓글 첫 페이지(최신 30건)와 그 답글을 평평하게 편다. 삭제된 것은 뺀다. */
export async function fetchLoungeComments(loungeId: string, feedId: number): Promise<LoungeComment[]> {
  const params = new URLSearchParams({ originalLoungeId: loungeId, limit: String(COMMENT_LIMIT), offset: "0", orderType: "NEW", pagingType: "PAGE" });
  const parsed = commentsSchema.parse(await getJson(`${COMMENT_BASE}/type/FEED/id/${feedId}/comments?${params}`));
  const comments: LoungeComment[] = [];
  for (const entry of parsed.content.comments.data) {
    for (const node of [entry, ...(entry.replyComments ?? [])]) {
      if (node.comment.deleted) continue;
      const text = (node.comment.content ?? "").trim();
      comments.push({
        commentId: node.comment.commentId,
        feedId,
        bodyText: node.comment.secret ? "(비밀 댓글)" : text || "(스티커·이미지)",
        nickname: node.user?.userNickname ?? null,
        isUser: node.user?.userRoleCode === USER_ROLE,
        postedAt: parseKstDate(node.comment.createdDate),
      });
    }
  }
  return comments;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/lib/naver-lounge.test.ts`
Expected: PASS

- [ ] **Step 5: 실제 API로 한 번 확인** (네트워크 필요, 읽기 전용)

Run: `npx vite-node --config vitest.config.ts -e 'import("./lib/naver-lounge").then(async (m) => { const p = await m.fetchLoungePosts("Tukiers_God_Tier_Life_Idle_Tycoon"); console.log(p.length, p[0]); console.log(await m.fetchLoungeComments("Tukiers_God_Tier_Life_Idle_Tycoon", p[0].feedId)); })'`
(`-e`가 안 되면 같은 내용을 스크래치패드의 `.ts` 파일로 만들어 `npx vite-node --config vitest.config.ts <파일>`로 실행.)
Expected: 글 8건 이상, 첫 글의 제목·본문·`isUser`·ISO 시각이 찍힌다.

- [ ] **Step 6: Commit**

```bash
git add lib/naver-lounge.ts tests/lib/naver-lounge.test.ts
git commit -m "feat: 네이버 게임 라운지 글·댓글 읽기"
```

---

### Task 3: 항목 저장소와 동기화 (`lib/lounge-items.ts`, `lib/lounge-sync.ts`)

**Files:**
- Create: `lib/lounge-items.ts`, `lib/lounge-sync.ts`
- Test: `tests/lib/lounge-sync.test.ts`

**Interfaces:**
- Consumes: Task 2의 `fetchLoungePosts`, `fetchLoungeComments`, `LoungePost`, `LoungeComment`.
- Produces:

```ts
// lib/lounge-items.ts
export interface LoungeItemRow { id: string; gameId: string; kind: "post" | "comment"; naverId: number; feedId: number; title: string; body: string; boardName: string | null; nickname: string | null; isUser: boolean; url: string; postedAt: string; readAt: string | null }
export function mapLoungeItem(row: Record<string, unknown>): LoungeItemRow
export function listLoungeItems(supabase, gameId: string, limit?: number): Promise<LoungeItemRow[]>
export function countUnreadLoungeItems(supabase, gameId: string): Promise<number | null>
export function countUnreadLoungeItemsByGame(supabase): Promise<Record<string, number>>
export function markLoungeItemRead(supabase, id: string): Promise<boolean>
export function markAllLoungeItemsRead(supabase, gameId: string): Promise<boolean>
// lib/lounge-sync.ts
export interface LoungeSyncResult { gameId: string; gameName: string; fetched: number; added: LoungeItemRow[]; error?: "fetch_failed" }
export function syncAllLounges(supabase, options?: { now?: Date }): Promise<LoungeSyncResult[]>
```

- [ ] **Step 1: `lib/lounge-items.ts` 작성** (얇은 DB 접근이라 동기화 테스트와 Task 8의 라우트 테스트가 덮는다)

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

/** 네이버 라운지에서 가져온 글·댓글 한 건. read_at이 null이면 관리자가 아직 안 본 유저 항목이다. */
export interface LoungeItemRow {
  id: string;
  gameId: string;
  kind: "post" | "comment";
  naverId: number;
  feedId: number;
  title: string;
  body: string;
  boardName: string | null;
  nickname: string | null;
  isUser: boolean;
  url: string;
  postedAt: string;
  readAt: string | null;
}

export function mapLoungeItem(row: Record<string, unknown>): LoungeItemRow {
  return {
    id: row.id as string,
    gameId: row.game_id as string,
    kind: row.kind as LoungeItemRow["kind"],
    naverId: Number(row.naver_id),
    feedId: Number(row.feed_id),
    title: row.title as string,
    body: (row.body as string) ?? "",
    boardName: (row.board_name as string | null) ?? null,
    nickname: (row.nickname as string | null) ?? null,
    isUser: Boolean(row.is_user),
    url: row.url as string,
    postedAt: row.posted_at as string,
    readAt: (row.read_at as string | null) ?? null,
  };
}

export async function listLoungeItems(supabase: SupabaseClient, gameId: string, limit = 100): Promise<LoungeItemRow[]> {
  const { data, error } = await supabase
    .from("lounge_items")
    .select("*")
    .eq("game_id", gameId)
    .order("posted_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data.map(mapLoungeItem);
}

/** 건수는 부가 정보다. 실패하면 null을 돌려 화면이 건수 없이 그리게 한다. */
export async function countUnreadLoungeItems(supabase: SupabaseClient, gameId: string): Promise<number | null> {
  const { count, error } = await supabase
    .from("lounge_items")
    .select("id", { count: "exact", head: true })
    .eq("game_id", gameId)
    .is("read_at", null);
  return error ? null : count ?? 0;
}

/** 게임 레일 배지용. 실패하면 빈 객체. */
export async function countUnreadLoungeItemsByGame(supabase: SupabaseClient): Promise<Record<string, number>> {
  const { data, error } = await supabase.from("lounge_items").select("game_id").is("read_at", null);
  if (error || !data) return {};
  const counts: Record<string, number> = {};
  for (const row of data as Array<{ game_id: string }>) {
    counts[row.game_id] = (counts[row.game_id] ?? 0) + 1;
  }
  return counts;
}

export async function markLoungeItemRead(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { error } = await supabase.from("lounge_items").update({ read_at: new Date().toISOString() }).eq("id", id).is("read_at", null);
  return !error;
}

export async function markAllLoungeItemsRead(supabase: SupabaseClient, gameId: string): Promise<boolean> {
  const { error } = await supabase.from("lounge_items").update({ read_at: new Date().toISOString() }).eq("game_id", gameId).is("read_at", null);
  return !error;
}
```

- [ ] **Step 2: 실패하는 동기화 테스트 작성** (`tests/lib/lounge-sync.test.ts`)

가짜 Supabase는 `reply-sync` 테스트처럼 손으로 만든다. 체인 메서드는 자기 자신을 돌려주고 `await`될 때 표와 첫 동작으로 결과를 정한다.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { fetchLoungePosts, fetchLoungeComments } = vi.hoisted(() => ({ fetchLoungePosts: vi.fn(), fetchLoungeComments: vi.fn() }));
vi.mock("@/lib/naver-lounge", () => ({ fetchLoungePosts, fetchLoungeComments }));

import { syncAllLounges } from "@/lib/lounge-sync";

const NOW = new Date("2026-09-21T10:00:00.000Z");
const BEFORE = "2026-09-21T09:50:00.000Z"; // 이전 동기화 시각
const OLD = "2026-09-21T09:00:00.000Z";
const FRESH = "2026-09-21T09:57:00.000Z";

interface GameSeed { id: string; name: string; naver_lounge_id: string; lounge_synced_at: string | null }
type Row = Record<string, unknown>;

function fakeSupabase(games: GameSeed[], seedItems: Row[] = []) {
  const items: Row[] = seedItems.map((row, i) => ({ id: `seed-${i}`, ...row }));
  const gameUpdates: Array<{ id: string; patch: Row }> = [];
  const client = {
    items,
    gameUpdates,
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let op: "select" | "upsert" | "update" = "select";
      let payload: Row[] | Row = [];
      const builder = {
        select: () => builder,
        not: () => builder,
        eq: (col: string, value: unknown) => (filters.push([col, value]), builder),
        in: (col: string, values: unknown[]) => (filters.push([col, values]), builder),
        upsert: (rows: Row[]) => ((op = "upsert"), (payload = rows), builder),
        update: (patch: Row) => ((op = "update"), (payload = patch), builder),
        then(resolve: (value: { data: unknown; error: null }) => void) {
          resolve({ data: run(), error: null });
        },
      };
      const matches = (row: Row) => filters.every(([col, value]) => (Array.isArray(value) ? value.includes(row[col]) : row[col] === value));
      function run(): unknown {
        if (table === "games") {
          if (op === "update") gameUpdates.push({ id: filters[0][1] as string, patch: payload as Row });
          return games;
        }
        if (op === "upsert") {
          const inserted: Row[] = [];
          for (const row of payload as Row[]) {
            if (items.some((it) => it.game_id === row.game_id && it.kind === row.kind && it.naver_id === row.naver_id)) continue;
            const withId = { id: `new-${items.length}`, ...row };
            items.push(withId);
            inserted.push(withId);
          }
          return inserted;
        }
        if (op === "update") {
          items.filter(matches).forEach((row) => Object.assign(row, payload));
          return null;
        }
        return items.filter(matches);
      }
      return builder;
    },
  };
  return client;
}

const game = (over: Partial<GameSeed> = {}): GameSeed => ({ id: "g1", name: "갓생 토크", naver_lounge_id: "L1", lounge_synced_at: BEFORE, ...over });
const post = (over: Record<string, unknown> = {}) => ({
  feedId: 100, title: "질문 있어요", bodyText: "본문", boardName: "자유", nickname: "유저1", isUser: true, postedAt: FRESH,
  url: "https://game.naver.com/lounge/L1/board/detail/100", commentCount: 0, ...over,
});
const comment = (over: Record<string, unknown> = {}) => ({ commentId: 500, feedId: 100, bodyText: "댓글", nickname: "유저2", isUser: true, postedAt: FRESH, ...over });
const seedPost = (over: Row = {}): Row => ({ game_id: "g1", kind: "post", naver_id: 100, feed_id: 100, title: "질문 있어요", url: "u", is_user: true, comment_count: 0, read_at: OLD, posted_at: OLD, ...over });

beforeEach(() => {
  fetchLoungePosts.mockReset();
  fetchLoungeComments.mockReset().mockResolvedValue([]);
});

describe("syncAllLounges", () => {
  it("stores a new user post as unread and reports it as added", async () => {
    fetchLoungePosts.mockResolvedValue([post()]);
    const supabase = fakeSupabase([game()]);
    const [result] = await syncAllLounges(supabase as never, { now: NOW });
    expect(result).toMatchObject({ gameId: "g1", gameName: "갓생 토크", fetched: 1 });
    expect(result.added).toHaveLength(1);
    expect(result.added[0]).toMatchObject({ kind: "post", naverId: 100, title: "질문 있어요", readAt: null });
    expect(supabase.items[0]).toMatchObject({ read_at: null, comment_count: 0, is_user: true });
    expect(supabase.gameUpdates).toEqual([{ id: "g1", patch: { lounge_synced_at: NOW.toISOString() } }]);
    expect(fetchLoungeComments).not.toHaveBeenCalled();
  });

  it("marks everything read on the first run so connecting a lounge does not flood", async () => {
    fetchLoungePosts.mockResolvedValue([post({ commentCount: 1 })]);
    fetchLoungeComments.mockResolvedValue([comment()]);
    const supabase = fakeSupabase([game({ lounge_synced_at: null })]);
    const [result] = await syncAllLounges(supabase as never, { now: NOW });
    expect(result.added).toEqual([]);
    expect(supabase.items).toHaveLength(2);
    expect(supabase.items.every((row) => row.read_at === NOW.toISOString())).toBe(true);
  });

  it("stores GM posts as read and never reports them", async () => {
    fetchLoungePosts.mockResolvedValue([post({ isUser: false })]);
    const supabase = fakeSupabase([game()]);
    const [result] = await syncAllLounges(supabase as never, { now: NOW });
    expect(result.added).toEqual([]);
    expect(supabase.items[0].read_at).toBe(NOW.toISOString());
  });

  it("reads comments only for posts whose comment count changed, and titles them after the post", async () => {
    fetchLoungePosts.mockResolvedValue([post({ commentCount: 2, postedAt: OLD }), post({ feedId: 101, commentCount: 3, postedAt: OLD })]);
    fetchLoungeComments.mockResolvedValue([comment(), comment({ commentId: 501, isUser: false }), comment({ commentId: 502, postedAt: OLD })]);
    const supabase = fakeSupabase([game()], [seedPost({ comment_count: 1 }), seedPost({ naver_id: 101, feed_id: 101, comment_count: 3 })]);
    const [result] = await syncAllLounges(supabase as never, { now: NOW });
    expect(fetchLoungeComments).toHaveBeenCalledTimes(1);
    expect(fetchLoungeComments).toHaveBeenCalledWith("L1", 100);
    // 유저 댓글이면서 이전 동기화 뒤에 쓴 500번만 알림. GM(501)과 옛 댓글(502)은 읽음.
    expect(result.added.map((item) => item.naverId)).toEqual([500]);
    expect(result.added[0]).toMatchObject({ kind: "comment", feedId: 100, title: "질문 있어요", url: "https://game.naver.com/lounge/L1/board/detail/100" });
    expect(supabase.items.find((row) => row.kind === "post" && row.naver_id === 100)?.comment_count).toBe(2);
  });

  it("keeps the stored comment count when reading comments fails so the next run retries", async () => {
    fetchLoungePosts.mockResolvedValue([post({ commentCount: 2, postedAt: OLD })]);
    fetchLoungeComments.mockRejectedValue(new Error("boom"));
    const supabase = fakeSupabase([game()], [seedPost({ comment_count: 1 })]);
    const [result] = await syncAllLounges(supabase as never, { now: NOW });
    expect(result.error).toBeUndefined();
    expect(supabase.items[0].comment_count).toBe(1);
  });

  it("reports fetch_failed without advancing the watermark, and still syncs the other games", async () => {
    fetchLoungePosts.mockRejectedValueOnce(new Error("naver down")).mockResolvedValueOnce([post()]);
    const supabase = fakeSupabase([game(), game({ id: "g2", name: "둘째", naver_lounge_id: "L2" })]);
    const results = await syncAllLounges(supabase as never, { now: NOW });
    expect(results[0]).toMatchObject({ gameId: "g1", error: "fetch_failed", added: [] });
    expect(results[1].added).toHaveLength(1);
    expect(supabase.gameUpdates.map((u) => u.id)).toEqual(["g2"]);
  });

  it("reads comments for at most 20 posts per run", async () => {
    fetchLoungePosts.mockResolvedValue(Array.from({ length: 25 }, (_, i) => post({ feedId: 200 + i, commentCount: 1 })));
    const supabase = fakeSupabase([game()]);
    await syncAllLounges(supabase as never, { now: NOW });
    expect(fetchLoungeComments).toHaveBeenCalledTimes(20);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run tests/lib/lounge-sync.test.ts`
Expected: FAIL — `@/lib/lounge-sync`를 찾을 수 없음.

- [ ] **Step 4: `lib/lounge-sync.ts` 구현**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchLoungeComments, fetchLoungePosts, type LoungeComment, type LoungePost } from "@/lib/naver-lounge";
import { mapLoungeItem, type LoungeItemRow } from "@/lib/lounge-items";

/**
 * 네이버 라운지 동기화. pg_cron이 5분마다 /api/lounge/sync를 부르면 라운지가 연결된 게임마다
 * 최신 글을 읽어 처음 보는 글을 넣고, 댓글 수가 달라진 글만 댓글을 읽는다.
 *
 * 알림(read_at = null)이 되는 것은 "유저가 쓴 항목"이면서 "이전 동기화 뒤에 쓴 항목"뿐이다.
 * 첫 실행은 이전 동기화가 없어 기준을 지금으로 잡으므로 기존 글·댓글이 전부 읽음으로 들어간다.
 */

/** 한 번 실행에 댓글을 읽는 글 수. 서버리스 함수 시간 안에 끝나야 한다. 남은 글은 다음 실행이 본다. */
const COMMENT_FETCH_LIMIT = 20;
const BODY_LIMIT = 1000;
const ON_CONFLICT = "game_id,kind,naver_id";

export interface LoungeSyncResult {
  gameId: string;
  gameName: string;
  fetched: number;
  /** 이번에 새로 들어간 안 읽은 유저 항목. Slack 알림이 이걸 쓴다. */
  added: LoungeItemRow[];
  error?: "fetch_failed";
}

interface SyncOptions {
  now?: Date;
}

interface LoungeGame {
  id: string;
  name: string;
  naver_lounge_id: string;
  lounge_synced_at: string | null;
}

function readAtFor(isUser: boolean, postedAt: string, baseline: number, nowIso: string): string | null {
  return isUser && new Date(postedAt).getTime() > baseline ? null : nowIso;
}

function postRow(game: LoungeGame, post: LoungePost, baseline: number, nowIso: string) {
  return {
    game_id: game.id,
    kind: "post",
    naver_id: post.feedId,
    feed_id: post.feedId,
    title: post.title,
    body: post.bodyText.slice(0, BODY_LIMIT),
    board_name: post.boardName,
    nickname: post.nickname,
    is_user: post.isUser,
    url: post.url,
    // 0으로 넣어 두면 댓글이 있는 새 글은 바로 아래에서 댓글을 한 번 읽는다.
    comment_count: 0,
    posted_at: post.postedAt,
    read_at: readAtFor(post.isUser, post.postedAt, baseline, nowIso),
  };
}

function commentRow(game: LoungeGame, post: LoungePost, comment: LoungeComment, baseline: number, nowIso: string) {
  return {
    game_id: game.id,
    kind: "comment",
    naver_id: comment.commentId,
    feed_id: post.feedId,
    title: post.title,
    body: comment.bodyText.slice(0, BODY_LIMIT),
    board_name: post.boardName,
    nickname: comment.nickname,
    is_user: comment.isUser,
    url: post.url,
    comment_count: null,
    posted_at: comment.postedAt,
    read_at: readAtFor(comment.isUser, comment.postedAt, baseline, nowIso),
  };
}

/** 처음 보는 행만 넣고, 그중 안 읽음으로 들어간 것을 돌려준다. 중복은 유니크 인덱스가 거른다. */
async function insertNew(supabase: SupabaseClient, rows: Array<Record<string, unknown>>): Promise<LoungeItemRow[]> {
  if (rows.length === 0) return [];
  const { data, error } = await supabase.from("lounge_items").upsert(rows, { onConflict: ON_CONFLICT, ignoreDuplicates: true }).select("*");
  if (error) throw new Error(`lounge_items insert failed: ${error.message}`);
  return (data ?? []).map(mapLoungeItem).filter((item) => item.readAt === null);
}

async function syncLounge(supabase: SupabaseClient, game: LoungeGame, now: Date): Promise<LoungeSyncResult> {
  const result: LoungeSyncResult = { gameId: game.id, gameName: game.name, fetched: 0, added: [] };
  const nowIso = now.toISOString();
  const baseline = game.lounge_synced_at ? new Date(game.lounge_synced_at).getTime() : now.getTime();

  let posts: LoungePost[];
  const knownCounts = new Map<number, number>();
  try {
    posts = await fetchLoungePosts(game.naver_lounge_id);
    result.fetched = posts.length;
    if (posts.length > 0) {
      const { data, error } = await supabase
        .from("lounge_items")
        .select("feed_id, comment_count")
        .eq("game_id", game.id)
        .eq("kind", "post")
        .in("feed_id", posts.map((post) => post.feedId));
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as Array<{ feed_id: number; comment_count: number | null }>) {
        knownCounts.set(Number(row.feed_id), row.comment_count ?? 0);
      }
    }
    const newPosts = posts.filter((post) => !knownCounts.has(post.feedId));
    result.added.push(...(await insertNew(supabase, newPosts.map((post) => postRow(game, post, baseline, nowIso)))));
  } catch (err) {
    // 확인 시각을 갱신하지 않아 다음 실행이 같은 기준으로 다시 본다.
    console.warn("[lounge-sync] 글 목록 실패", { gameId: game.id, err });
    return { ...result, added: [], error: "fetch_failed" };
  }

  const changed = posts.filter((post) => post.commentCount !== (knownCounts.get(post.feedId) ?? 0)).slice(0, COMMENT_FETCH_LIMIT);
  for (const post of changed) {
    try {
      const comments = await fetchLoungeComments(game.naver_lounge_id, post.feedId);
      result.added.push(...(await insertNew(supabase, comments.map((comment) => commentRow(game, post, comment, baseline, nowIso)))));
      await supabase.from("lounge_items").update({ comment_count: post.commentCount }).eq("game_id", game.id).eq("kind", "post").eq("naver_id", post.feedId);
    } catch (err) {
      // comment_count를 그대로 둬 다음 실행이 이 글의 댓글을 다시 읽는다.
      console.warn("[lounge-sync] 댓글 실패", { gameId: game.id, feedId: post.feedId, err });
    }
  }

  await supabase.from("games").update({ lounge_synced_at: nowIso }).eq("id", game.id);
  return result;
}

/** 라운지가 연결된 게임을 차례로 동기화한다. 던지지 않는다 — 게임 하나의 실패가 나머지를 막지 않는다. */
export async function syncAllLounges(supabase: SupabaseClient, options: SyncOptions = {}): Promise<LoungeSyncResult[]> {
  const now = options.now ?? new Date();
  const { data, error } = await supabase.from("games").select("id, name, naver_lounge_id, lounge_synced_at").not("naver_lounge_id", "is", null);
  if (error || !data) {
    console.warn("[lounge-sync] 게임 목록 실패", error);
    return [];
  }
  const results: LoungeSyncResult[] = [];
  for (const game of data as LoungeGame[]) {
    results.push(await syncLounge(supabase, game, now));
  }
  return results;
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/lib/lounge-sync.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/lounge-items.ts lib/lounge-sync.ts tests/lib/lounge-sync.test.ts
git commit -m "feat: 라운지 글·댓글을 lounge_items에 동기화"
```

---

### Task 4: Slack 메시지 (`lib/slack.ts`)

**Files:**
- Modify: `lib/slack.ts`
- Test: `tests/lib/slack.test.ts` (기존 파일 끝에 describe 추가)

**Interfaces:**
- Consumes: `LoungeItemRow`(Task 3).
- Produces: `buildLoungeSlackMessage(input: { gameName: string; items: LoungeItemRow[]; listUrl: string }): SlackMessage`

- [ ] **Step 1: 실패하는 테스트 추가** — `tests/lib/slack.test.ts` 맨 아래에 붙인다(`buildLoungeSlackMessage`를 기존 import에 더한다).

```ts
import type { LoungeItemRow } from "@/lib/lounge-items";

const loungeItem = (over: Partial<LoungeItemRow> = {}): LoungeItemRow => ({
  id: "i1", gameId: "g1", kind: "post", naverId: 100, feedId: 100, title: "질문 <있어요>", body: "본문 & 내용", boardName: "자유", nickname: "유저1",
  isUser: true, url: "https://game.naver.com/lounge/L1/board/detail/100", postedAt: "2026-09-21T09:57:00.000Z", readAt: null, ...over,
});

describe("buildLoungeSlackMessage", () => {
  it("builds one green attachment with a section per item and escapes user text", () => {
    const message = buildLoungeSlackMessage({ gameName: "갓생 토크", items: [loungeItem(), loungeItem({ id: "i2", kind: "comment", naverId: 500, body: "댓글", nickname: "유저2" })], listUrl: "https://admin.example/games/g1/lounge" });
    expect(message.text).toBe("[갓생 토크] 라운지 새 글 · 질문 &lt;있어요&gt; 외 1건");
    expect(message.attachments[0].color).toBe("#03C75A");
    const json = JSON.stringify(message.attachments[0].blocks);
    expect(json).toContain("💬 *[갓생 토크] 라운지 새 글*");
    expect(json).toContain("💬 *[갓생 토크] 라운지 새 댓글*");
    expect(json).toContain("<https://game.naver.com/lounge/L1/board/detail/100|질문 &lt;있어요&gt;>");
    expect(json).toContain("> 본문 &amp; 내용");
    expect(json).toContain("자유 · 유저1");
    expect(json).toContain("<https://admin.example/games/g1/lounge|관리자에서 보기>");
  });

  it("shows only the first five items and counts the rest", () => {
    const items = Array.from({ length: 7 }, (_, i) => loungeItem({ id: `i${i}`, naverId: 100 + i, title: `글 ${i}` }));
    const message = buildLoungeSlackMessage({ gameName: "갓생 토크", items, listUrl: "https://admin.example/games/g1/lounge" });
    const json = JSON.stringify(message.attachments[0].blocks);
    expect(json).toContain("글 4");
    expect(json).not.toContain("글 5");
    expect(json).toContain("외 2건");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/lib/slack.test.ts`
Expected: FAIL — `buildLoungeSlackMessage` is not a function.

- [ ] **Step 3: 구현** — `lib/slack.ts`에서 `NORMAL_COLOR` 아래에 상수를, `sendSlackMessage` 위에 함수를 추가한다. 파일 맨 위 import에 `import type { LoungeItemRow } from "@/lib/lounge-items";`.

```ts
/** 네이버 라운지 알림의 세로줄 색(네이버 초록). */
const LOUNGE_COLOR = "#03C75A";
/** 한 메시지에 싣는 라운지 항목 수. 넘는 만큼은 "외 N건"으로 줄인다. */
const LOUNGE_ITEM_LIMIT = 5;
```

```ts
export interface LoungeSlackInput {
  gameName: string;
  items: LoungeItemRow[];
  /** 관리자 페이지의 라운지 목록 주소. */
  listUrl: string;
}

/** 라운지 새 글·댓글 알림. 게임마다 메시지 하나에 항목을 모아 보낸다. items는 비어 있지 않아야 한다. */
export function buildLoungeSlackMessage(input: LoungeSlackInput): SlackMessage {
  const gameName = escapeMrkdwn(input.gameName);
  const shown = input.items.slice(0, LOUNGE_ITEM_LIMIT);
  const moreCount = input.items.length - shown.length;

  const blocks: unknown[] = [];
  for (const item of shown) {
    const heading = `[${gameName}] ${item.kind === "post" ? "라운지 새 글" : "라운지 새 댓글"}`;
    const meta = [item.boardName, item.nickname].filter((part): part is string => Boolean(part)).map(escapeMrkdwn).join(" · ");
    const lines = [`💬 *${heading}*`, meta, `<${item.url}|${escapeMrkdwn(item.title)}>`].filter(Boolean);
    blocks.push({ type: "section", text: { type: "mrkdwn", text: lines.join("\n") } });
    const body = quoteBody(item.body);
    if (body) {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: body } });
    }
  }
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `${moreCount > 0 ? `외 ${moreCount}건 · ` : ""}<${input.listUrl}|관리자에서 보기>` }],
  });

  const rest = input.items.length - 1;
  return {
    text: `[${gameName}] 라운지 새 글 · ${escapeMrkdwn(input.items[0].title)}${rest > 0 ? ` 외 ${rest}건` : ""}`,
    attachments: [{ color: LOUNGE_COLOR, blocks }],
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/lib/slack.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/slack.ts tests/lib/slack.test.ts
git commit -m "feat: 라운지 새 글·댓글 Slack 메시지"
```

---

### Task 5: 동기화 라우트 (`/api/lounge/sync`)

**Files:**
- Create: `app/api/lounge/sync/route.ts`
- Test: `tests/api/lounge-sync.test.ts`

**Interfaces:**
- Consumes: `syncAllLounges`, `LoungeSyncResult`(Task 3), `buildLoungeSlackMessage`(Task 4), `sendSlackMessage`, `isWebhookAuthorized`, `getSupabaseServerClient`.
- Produces: `POST /api/lounge/sync` → `{ success, results: [{ gameId, fetched, added: number, error? }], notified: number }`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/lounge/sync/route";
import * as supabaseModule from "@/lib/supabase";
import * as syncModule from "@/lib/lounge-sync";
import * as slackModule from "@/lib/slack";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/lounge-sync", () => ({ syncAllLounges: vi.fn() }));
vi.mock("@/lib/slack", () => ({ buildLoungeSlackMessage: vi.fn(() => ({ text: "t", attachments: [] })), sendSlackMessage: vi.fn() }));

const item = { id: "i1", gameId: "g1", kind: "post", naverId: 100, feedId: 100, title: "글", body: "", boardName: null, nickname: null, isUser: true, url: "u", postedAt: "2026-09-21T09:57:00.000Z", readAt: null };

function makeRequest(secret = "s3cret") {
  return new Request("https://admin.example/api/lounge/sync", { method: "POST", headers: { "x-webhook-secret": secret }, body: "{}" });
}

describe("POST /api/lounge/sync", () => {
  beforeEach(() => {
    vi.stubEnv("INQUIRY_WEBHOOK_SECRET", "s3cret");
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.example/x");
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({} as never);
    vi.mocked(syncModule.syncAllLounges).mockReset();
    vi.mocked(slackModule.sendSlackMessage).mockReset().mockResolvedValue();
    vi.mocked(slackModule.buildLoungeSlackMessage).mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects a wrong secret without syncing", async () => {
    const response = await POST(makeRequest("nope"));
    expect(response.status).toBe(401);
    expect(syncModule.syncAllLounges).not.toHaveBeenCalled();
  });

  it("syncs, sends one Slack message per game with new items, and reports counts", async () => {
    vi.mocked(syncModule.syncAllLounges).mockResolvedValue([
      { gameId: "g1", gameName: "갓생 토크", fetched: 8, added: [item as never] },
      { gameId: "g2", gameName: "둘째", fetched: 3, added: [] },
    ]);
    const response = await POST(makeRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      results: [{ gameId: "g1", fetched: 8, added: 1 }, { gameId: "g2", fetched: 3, added: 0 }],
      notified: 1,
    });
    expect(slackModule.buildLoungeSlackMessage).toHaveBeenCalledWith({ gameName: "갓생 토크", items: [item], listUrl: "https://admin.example/games/g1/lounge" });
    expect(slackModule.sendSlackMessage).toHaveBeenCalledTimes(1);
  });

  it("skips Slack quietly when the webhook url is missing", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "");
    vi.mocked(syncModule.syncAllLounges).mockResolvedValue([{ gameId: "g1", gameName: "갓생 토크", fetched: 8, added: [item as never] }]);
    const json = await (await POST(makeRequest())).json();
    expect(json.notified).toBe(0);
    expect(slackModule.sendSlackMessage).not.toHaveBeenCalled();
  });

  it("still succeeds when Slack fails — the items are already stored", async () => {
    vi.mocked(slackModule.sendSlackMessage).mockRejectedValue(new Error("slack down"));
    vi.mocked(syncModule.syncAllLounges).mockResolvedValue([{ gameId: "g1", gameName: "갓생 토크", fetched: 8, added: [item as never] }]);
    const response = await POST(makeRequest());
    expect(response.status).toBe(200);
    expect((await response.json()).notified).toBe(0);
  });

  it("returns 502 when every lounge failed", async () => {
    vi.mocked(syncModule.syncAllLounges).mockResolvedValue([{ gameId: "g1", gameName: "갓생 토크", fetched: 0, added: [], error: "fetch_failed" }]);
    const response = await POST(makeRequest());
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe("sync_failed");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/api/lounge-sync.test.ts`
Expected: FAIL — 라우트 모듈 없음.

- [ ] **Step 3: 구현**

```ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { isWebhookAuthorized } from "@/lib/webhook-secret";
import { syncAllLounges } from "@/lib/lounge-sync";
import { buildLoungeSlackMessage, sendSlackMessage } from "@/lib/slack";

/**
 * 네이버 라운지 동기화 진입점. Supabase pg_cron 잡 lounge-sync-run이 5분마다 부른다(마이그레이션 0024).
 * 새 유저 글·댓글은 게임마다 Slack 메시지 하나로 알린다. Slack은 부가 작업이라 실패해도 200이다 —
 * 항목은 이미 저장돼 관리자 화면에 보인다.
 */
export async function POST(request: Request) {
  if (!isWebhookAuthorized(request)) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const results = await syncAllLounges(getSupabaseServerClient());
  const summary = results.map((result) => ({
    gameId: result.gameId,
    fetched: result.fetched,
    added: result.added.length,
    ...(result.error ? { error: result.error } : {}),
  }));

  const allFailed = results.length > 0 && results.every((result) => result.error);
  if (allFailed) {
    return NextResponse.json({ success: false, error: "sync_failed", results: summary }, { status: 502 });
  }

  let notified = 0;
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (webhookUrl) {
    const origin = new URL(request.url).origin;
    for (const result of results) {
      if (result.added.length === 0) continue;
      try {
        await sendSlackMessage(webhookUrl, buildLoungeSlackMessage({ gameName: result.gameName, items: result.added, listUrl: `${origin}/games/${result.gameId}/lounge` }));
        notified += 1;
      } catch (error) {
        console.error("[lounge/sync] Slack 전송 실패", { gameId: result.gameId, error });
      }
    }
  }

  return NextResponse.json({ success: true, results: summary, notified });
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/api/lounge-sync.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add app/api/lounge/sync/route.ts tests/api/lounge-sync.test.ts
git commit -m "feat: 라운지 동기화 cron 라우트와 Slack 알림"
```

---

### Task 6: 라운지 연결 — 공용 로직, PATCH 라우트, 게임 추가

**Files:**
- Create: `lib/lounge-connect.ts`, `app/api/games/[gameId]/lounge/route.ts`
- Modify: `lib/game-schema.ts`, `app/api/games/route.ts`, `components/games/GameForm.tsx`
- Test: `tests/lib/lounge-connect.test.ts`, `tests/api/games-lounge.test.ts`, `tests/api/games.test.ts`, `tests/components/GameForm.test.tsx`

**Interfaces:**
- Consumes: `parseLoungeId`, `fetchLoungePosts`(Task 2).
- Produces:

```ts
export type ConnectLoungeResult = { ok: true; loungeId: string | null } | { ok: false; error: "invalid_lounge" | "lounge_unreachable" | "save_failed" };
export function connectLounge(supabase: SupabaseClient, gameId: string, input: string): Promise<ConnectLoungeResult>
```
`PATCH /api/games/{gameId}/lounge` body `{ loungeUrl: string }` → 200 `{ success: true, loungeId }` / 400 `invalid_lounge`·`lounge_unreachable` / 401 / 404 `not_found` / 500 `save_failed`. `POST /api/games`는 폼 필드 `loungeUrl`을 받고 실패 시 `warning: "lounge_unreachable"`.

- [ ] **Step 1: `connectLounge` 실패 테스트** (`tests/lib/lounge-connect.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { fetchLoungePosts } = vi.hoisted(() => ({ fetchLoungePosts: vi.fn() }));
vi.mock("@/lib/naver-lounge", async (original) => ({ ...(await original<typeof import("@/lib/naver-lounge")>()), fetchLoungePosts }));

import { connectLounge } from "@/lib/lounge-connect";

function fakeSupabase(current: string | null, updateError: unknown = null) {
  const calls = { updates: [] as unknown[], deletes: 0 };
  const client = {
    calls,
    from(table: string) {
      if (table === "games") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { naver_lounge_id: current }, error: null }) }) }),
          update: (patch: unknown) => (calls.updates.push(patch), { eq: () => Promise.resolve({ error: updateError }) }),
        };
      }
      return { delete: () => ({ eq: () => ((calls.deletes += 1), Promise.resolve({ error: null })) }) };
    },
  };
  return client;
}

beforeEach(() => fetchLoungePosts.mockReset().mockResolvedValue([]));

describe("connectLounge", () => {
  it("saves the id from a url, resets the watermark, and clears old items", async () => {
    const supabase = fakeSupabase("Old_Lounge");
    const result = await connectLounge(supabase as never, "g1", "https://game.naver.com/lounge/New_Lounge/home");
    expect(result).toEqual({ ok: true, loungeId: "New_Lounge" });
    expect(fetchLoungePosts).toHaveBeenCalledWith("New_Lounge");
    expect(supabase.calls.updates).toEqual([{ naver_lounge_id: "New_Lounge", lounge_synced_at: null }]);
    expect(supabase.calls.deletes).toBe(1);
  });

  it("does nothing when the same lounge is already connected", async () => {
    const supabase = fakeSupabase("Same");
    expect(await connectLounge(supabase as never, "g1", "Same")).toEqual({ ok: true, loungeId: "Same" });
    expect(supabase.calls.updates).toEqual([]);
    expect(supabase.calls.deletes).toBe(0);
  });

  it("disconnects on empty input", async () => {
    const supabase = fakeSupabase("Old");
    expect(await connectLounge(supabase as never, "g1", "  ")).toEqual({ ok: true, loungeId: null });
    expect(supabase.calls.updates).toEqual([{ naver_lounge_id: null, lounge_synced_at: null }]);
    expect(supabase.calls.deletes).toBe(1);
    expect(fetchLoungePosts).not.toHaveBeenCalled();
  });

  it("rejects junk and unreachable lounges without saving", async () => {
    const supabase = fakeSupabase(null);
    expect(await connectLounge(supabase as never, "g1", "https://example.com/x")).toEqual({ ok: false, error: "invalid_lounge" });
    fetchLoungePosts.mockRejectedValue(new Error("404"));
    expect(await connectLounge(supabase as never, "g1", "Nope")).toEqual({ ok: false, error: "lounge_unreachable" });
    expect(supabase.calls.updates).toEqual([]);
  });

  it("reports save_failed when the update fails", async () => {
    const supabase = fakeSupabase(null, { message: "db" });
    expect(await connectLounge(supabase as never, "g1", "Abc")).toEqual({ ok: false, error: "save_failed" });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/lib/lounge-connect.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: `lib/lounge-connect.ts` 구현**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchLoungePosts, parseLoungeId } from "@/lib/naver-lounge";

export type ConnectLoungeResult =
  | { ok: true; loungeId: string | null }
  | { ok: false; error: "invalid_lounge" | "lounge_unreachable" | "save_failed" };

/**
 * 게임에 네이버 라운지를 연결한다. 게임 추가와 연결 대화상자(PATCH)가 같이 쓴다.
 * 빈 입력은 연결 해제다. 저장 전에 라운지를 실제로 한 번 읽어 주소가 맞는지 확인한다.
 * 라운지가 바뀌면 이전 라운지의 항목을 지우고 동기화 기준도 되돌려 첫 실행처럼 다시 시작한다.
 */
export async function connectLounge(supabase: SupabaseClient, gameId: string, input: string): Promise<ConnectLoungeResult> {
  const trimmed = input.trim();
  const loungeId = trimmed ? parseLoungeId(trimmed) : null;
  if (trimmed && !loungeId) {
    return { ok: false, error: "invalid_lounge" };
  }

  const { data: current } = await supabase.from("games").select("naver_lounge_id").eq("id", gameId).maybeSingle();
  if ((current?.naver_lounge_id ?? null) === loungeId) {
    return { ok: true, loungeId };
  }

  if (loungeId) {
    try {
      await fetchLoungePosts(loungeId);
    } catch (error) {
      console.warn("[lounge-connect] 라운지를 읽지 못함", { gameId, loungeId, error });
      return { ok: false, error: "lounge_unreachable" };
    }
  }

  const { error } = await supabase.from("games").update({ naver_lounge_id: loungeId, lounge_synced_at: null }).eq("id", gameId);
  if (error) {
    return { ok: false, error: "save_failed" };
  }
  await supabase.from("lounge_items").delete().eq("game_id", gameId);
  return { ok: true, loungeId };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/lib/lounge-connect.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: PATCH 라우트 실패 테스트** (`tests/api/games-lounge.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PATCH } from "@/app/api/games/[gameId]/lounge/route";
import * as supabaseModule from "@/lib/supabase";
import * as sessionModule from "@/lib/require-admin-session";
import * as connectModule from "@/lib/lounge-connect";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/require-admin-session", () => ({ requireAdminSession: vi.fn() }));
vi.mock("@/lib/lounge-connect", () => ({ connectLounge: vi.fn() }));

function mockGame(found: boolean) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: found ? { id: "g1" } : null, error: null });
  vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) } as never);
}
const call = (body: unknown) =>
  PATCH(new Request("https://admin.example/api/games/g1/lounge", { method: "PATCH", body: JSON.stringify(body) }), { params: { gameId: "g1" } });

describe("PATCH /api/games/{gameId}/lounge", () => {
  beforeEach(() => {
    vi.mocked(sessionModule.requireAdminSession).mockResolvedValue(true);
    vi.mocked(connectModule.connectLounge).mockReset();
    mockGame(true);
  });

  it("requires an admin session", async () => {
    vi.mocked(sessionModule.requireAdminSession).mockResolvedValue(false);
    expect((await call({ loungeUrl: "Abc" })).status).toBe(401);
  });
  it("rejects a body without loungeUrl", async () => {
    expect((await call({})).status).toBe(400);
  });
  it("404s for an unknown game", async () => {
    mockGame(false);
    expect((await call({ loungeUrl: "Abc" })).status).toBe(404);
  });
  it("connects and returns the lounge id", async () => {
    vi.mocked(connectModule.connectLounge).mockResolvedValue({ ok: true, loungeId: "Abc" });
    const response = await call({ loungeUrl: "https://game.naver.com/lounge/Abc/home" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, loungeId: "Abc" });
    expect(connectModule.connectLounge).toHaveBeenCalledWith(expect.anything(), "g1", "https://game.naver.com/lounge/Abc/home");
  });
  it("maps connect errors to 400 and 500", async () => {
    vi.mocked(connectModule.connectLounge).mockResolvedValue({ ok: false, error: "lounge_unreachable" });
    const bad = await call({ loungeUrl: "Nope" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("lounge_unreachable");
    vi.mocked(connectModule.connectLounge).mockResolvedValue({ ok: false, error: "save_failed" });
    expect((await call({ loungeUrl: "Abc" })).status).toBe(500);
  });
});
```

- [ ] **Step 6: 실패 확인 후 라우트 구현** (`app/api/games/[gameId]/lounge/route.ts`)

Run: `npx vitest run tests/api/games-lounge.test.ts` → FAIL(모듈 없음). 그다음:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { connectLounge } from "@/lib/lounge-connect";

const bodySchema = z.object({ loungeUrl: z.string().max(500) });

/** 게임에 네이버 라운지를 연결·변경·해제한다. loungeUrl이 빈 문자열이면 해제. */
export async function PATCH(request: Request, { params }: { params: { gameId: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_input" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { data: game } = await supabase.from("games").select("id").eq("id", params.gameId).maybeSingle();
  if (!game) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }

  const result = await connectLounge(supabase, params.gameId, parsed.data.loungeUrl);
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.error === "save_failed" ? 500 : 400 });
  }
  return NextResponse.json({ success: true, loungeId: result.loungeId });
}
```

Run: `npx vitest run tests/api/games-lounge.test.ts` → PASS (5 tests)

- [ ] **Step 7: 게임 추가에 연결 — 테스트 먼저** (`tests/api/games.test.ts`)

파일 위쪽 mock 목록에 추가:

```ts
import * as loungeConnectModule from "@/lib/lounge-connect";
vi.mock("@/lib/lounge-connect", () => ({ connectLounge: vi.fn() }));
```

`describe("POST /api/games", ...)` 안에 테스트 두 개를 추가한다. 이 파일의 다른 성공 케이스가 쓰는 준비 코드(`getAdminSession` 세션 mock, `mockSupabaseSuccess()`, `isOpsDocConfigured` → false)를 그대로 따라 쓴다 — `beforeEach`에 이미 있으면 생략한다.

```ts
  it("connects the lounge after creating the game when loungeUrl is given", async () => {
    mockSupabaseSuccess();
    vi.mocked(loungeConnectModule.connectLounge).mockResolvedValue({ ok: true, loungeId: "Abc" });
    const response = await POST(new Request("http://localhost/api/games", { method: "POST", body: buildFormData({ loungeUrl: "https://game.naver.com/lounge/Abc/home" }) }));
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.game.naverLoungeId).toBe("Abc");
    expect(loungeConnectModule.connectLounge).toHaveBeenCalledWith(expect.anything(), "game-1", "https://game.naver.com/lounge/Abc/home");
  });

  it("keeps the game and warns when the lounge cannot be connected", async () => {
    mockSupabaseSuccess();
    vi.mocked(loungeConnectModule.connectLounge).mockResolvedValue({ ok: false, error: "lounge_unreachable" });
    const response = await POST(new Request("http://localhost/api/games", { method: "POST", body: buildFormData({ loungeUrl: "Nope" }) }));
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.game.naverLoungeId).toBeNull();
    expect(json.warning).toBe("lounge_unreachable");
  });
```

`ops_doc_not_configured` 경고가 먼저 잡히면 두 번째 테스트가 깨진다. 그 테스트에서는 `vi.mocked(opsDocModule.isOpsDocConfigured).mockReturnValue(true)`와 `createOpsDoc`/`insertSource` 성공 mock(`createOpsDoc` → `{ docId: "d", title: "t" }`, `insertSource` → `{}`)을 둬 다른 경고가 없게 한다.

Run: `npx vitest run tests/api/games.test.ts` → 새 테스트 2개 FAIL.

- [ ] **Step 8: 스키마·라우트 구현**

`lib/game-schema.ts`의 `gameFormSchema`에 추가:

```ts
  loungeUrl: z.string().trim().max(500).optional().default(""),
```

`app/api/games/route.ts`: import에 `import { connectLounge } from "@/lib/lounge-connect";`, `safeParse` 인자에 `loungeUrl: formData.get("loungeUrl") ?? "",` 추가. 운영 문서 블록 뒤, `return` 앞에:

```ts
  // 네이버 라운지 연결도 부가 작업이다. 주소가 틀렸거나 못 읽으면 게임은 두고 경고만 낸다 —
  // 문의함의 "네이버 라운지 연결"에서 다시 할 수 있다.
  let naverLoungeId: string | null = null;
  if (input.loungeUrl) {
    const lounge = await connectLounge(supabase, inserted.id, input.loungeUrl);
    if (lounge.ok) {
      naverLoungeId = lounge.loungeId;
    } else {
      console.error("[api/games] lounge connect failed", { gameId: inserted.id, error: lounge.error });
      warning = warning ?? "lounge_unreachable";
    }
  }
```

응답의 `game` 객체에 `naverLoungeId,`를 추가한다.

Run: `npx vitest run tests/api/games.test.ts` → PASS

- [ ] **Step 9: GameForm — 테스트 먼저** (`tests/components/GameForm.test.tsx`에 추가)

```ts
  it("sends the lounge url and warns when the lounge could not be connected", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, game: createdGame, warning: "lounge_unreachable" }),
    }) as never;
    const onCreated = vi.fn();
    render(<GameForm onCreated={onCreated} />);

    await userEvent.type(screen.getByLabelText("게임명"), "여신키우기");
    await userEvent.type(screen.getByLabelText(/네이버 라운지 주소/), "https://game.naver.com/lounge/Abc/home");
    await userEvent.click(screen.getByRole("button", { name: "게임 추가" }));

    const body = vi.mocked(global.fetch).mock.calls[0][1]?.body as FormData;
    expect(body.get("loungeUrl")).toBe("https://game.naver.com/lounge/Abc/home");
    expect(await screen.findByText(/네이버 라운지를 연결하지 못했습니다/)).toBeInTheDocument();
    expect(onCreated).toHaveBeenCalledWith(createdGame, "lounge_unreachable");
  });
```

Run: `npx vitest run tests/components/GameForm.test.tsx` → 새 테스트 FAIL.

- [ ] **Step 10: GameForm 구현** (`components/games/GameForm.tsx`)

- state: `const [loungeUrl, setLoungeUrl] = useState("");`
- `dirty`: `name !== "" || ownerName !== "" || loungeUrl !== "" || logo !== null`
- `handleSubmit`: `formData.set("loungeUrl", loungeUrl);` 추가, 성공 후 초기화에 `setLoungeUrl("");`
- `ops_doc_failed` 분기 뒤에:

```ts
    if (json.warning === "lounge_unreachable") {
      setMessageTone("warning");
      setMessage("게임은 추가되었지만 네이버 라운지를 연결하지 못했습니다. 주소를 확인한 뒤 문의함의 \"네이버 라운지 연결\"에서 다시 연결해주세요.");
      onCreated(json.game, json.warning);
      return;
    }
```

- "담당자" label 뒤에:

```tsx
      <label className="flex flex-col gap-1">
        <span>
          네이버 라운지 주소 <span className="text-xs text-muted">(선택)</span>
        </span>
        <input
          name="loungeUrl"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://game.naver.com/lounge/…/home"
          value={loungeUrl}
          onChange={(e) => setLoungeUrl(e.target.value)}
          className={INPUT}
        />
        <span className="text-xs text-muted">라운지에 유저 글·댓글이 올라오면 알려드립니다. 나중에 문의함에서 연결할 수도 있습니다.</span>
      </label>
```

Run: `npx vitest run tests/components/GameForm.test.tsx` → PASS

- [ ] **Step 11: Commit**

```bash
git add lib/lounge-connect.ts lib/game-schema.ts app/api/games components/games/GameForm.tsx tests/lib/lounge-connect.test.ts tests/api/games-lounge.test.ts tests/api/games.test.ts tests/components/GameForm.test.tsx
git commit -m "feat: 게임 추가와 PATCH로 네이버 라운지 연결"
```

---

### Task 7: 보기 열 — 라운지 링크·건수·연결 대화상자

**Files:**
- Create: `components/inbox/LoungeConnectDialog.tsx`
- Modify: `components/inbox/InboxNav.tsx`, `components/inbox/InboxShell.tsx`, `lib/inbox-page.ts`, 인박스 페이지(`app/(admin)/games/[gameId]/inquiries/**/page.tsx` — `loadInboxPage` 결과를 `InboxShell`에 넘기는 곳)
- Test: `tests/components/InboxNav.test.tsx`, `tests/components/LoungeConnectDialog.test.tsx`

**Interfaces:**
- Consumes: `countUnreadLoungeItems`(Task 3), `PATCH /api/games/{id}/lounge`(Task 6), `GameRow.naverLoungeId`(Task 1).
- Produces: `InboxPageData.loungeUnread: number | null`; `InboxNav`/`InboxShell` prop `loungeUnread?: number | null`.

- [ ] **Step 1: InboxNav 실패 테스트 추가** — `renderNav`를 건드리지 않고 직접 렌더한다.

```ts
  it("links to the lounge list with the unread count when a lounge is connected", () => {
    render(<InboxNav scope={gameScope("g1")} title={game.name} game={{ ...game, naverLoungeId: "Abc" }} query={DEFAULT_QUERY} labels={labels} counts={counts} selectedId={null} loungeUnread={4} />);
    const link = screen.getByRole("link", { name: /라운지 새 글/ });
    expect(link).toHaveAttribute("href", "/games/g1/lounge");
    expect(within(link).getByText("4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "네이버 라운지 변경" })).toBeInTheDocument();
  });

  it("offers to connect a lounge instead when none is connected", () => {
    renderNav();
    expect(screen.queryByRole("link", { name: /라운지 새 글/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "네이버 라운지 연결" })).toBeInTheDocument();
  });
```

Run: `npx vitest run tests/components/InboxNav.test.tsx` → 새 테스트 FAIL.

- [ ] **Step 2: `LoungeConnectDialog` 테스트** (`tests/components/LoungeConnectDialog.test.tsx`)

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoungeConnectDialog from "@/components/inbox/LoungeConnectDialog";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

describe("LoungeConnectDialog", () => {
  beforeEach(() => refresh.mockReset());

  it("opens, saves the url, and refreshes", async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true, loungeId: "Abc" }) }) as never;
    render(<LoungeConnectDialog gameId="g1" loungeId={null} />);
    await userEvent.click(screen.getByRole("button", { name: "네이버 라운지 연결" }));
    await userEvent.type(screen.getByLabelText("라운지 주소"), "https://game.naver.com/lounge/Abc/home");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(global.fetch).toHaveBeenCalledWith("/api/games/g1/lounge", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ loungeUrl: "https://game.naver.com/lounge/Abc/home" }) }));
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows why the lounge was rejected and stays open", async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: false, error: "lounge_unreachable" }) }) as never;
    render(<LoungeConnectDialog gameId="g1" loungeId="Old" />);
    await userEvent.click(screen.getByRole("button", { name: "네이버 라운지 변경" }));
    expect(screen.getByLabelText("라운지 주소")).toHaveValue("https://game.naver.com/lounge/Old/home");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText(/라운지를 읽을 수 없습니다/)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
```

Run: `npx vitest run tests/components/LoungeConnectDialog.test.tsx` → FAIL(모듈 없음).

- [ ] **Step 3: `LoungeConnectDialog` 구현**

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Dialog from "@/components/ui/Dialog";
import StatusMessage from "@/components/ui/StatusMessage";

const ERRORS: Record<string, string> = {
  invalid_lounge: "네이버 게임 라운지 주소가 아닙니다. https://game.naver.com/lounge/… 주소를 붙여넣어 주세요.",
  lounge_unreachable: "라운지를 읽을 수 없습니다. 주소를 다시 확인해주세요.",
};

/** 문의함 보기 열의 "네이버 라운지 연결". 주소를 비우고 저장하면 연결이 해제된다. */
export default function LoungeConnectDialog({ gameId, loungeId }: { gameId: string; loungeId: string | null }) {
  const router = useRouter();
  const initial = loungeId ? `https://game.naver.com/lounge/${loungeId}/home` : "";
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setUrl(initial);
    setError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    let json: { success: boolean; error?: string };
    try {
      const response = await fetch(`/api/games/${gameId}/lounge`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ loungeUrl: url }) });
      json = await response.json();
    } catch {
      json = { success: false };
    }
    setSaving(false);
    if (!json.success) {
      setError(ERRORS[json.error ?? ""] ?? "저장에 실패했습니다. 다시 시도해주세요.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center h-8 px-2.5 rounded-lg text-[13px] text-muted hover:bg-ground hover:text-ink transition-colors text-left"
      >
        {loungeId ? "네이버 라운지 변경" : "네이버 라운지 연결"}
      </button>
      {open && (
        <Dialog labelledBy="lounge-connect-title" onClose={close} dismissDisabled={saving} className="max-w-md">
          <h2 id="lounge-connect-title" className="text-lg font-bold mb-1">
            네이버 라운지 연결
          </h2>
          <p className="text-sm text-muted mb-4">라운지에 유저가 글·댓글을 쓰면 5분 안에 여기와 Slack으로 알려드립니다. 주소를 비우고 저장하면 연결이 해제됩니다.</p>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-sm">라운지 주소</span>
              <input
                type="text"
                inputMode="url"
                autoComplete="off"
                data-autofocus
                placeholder="https://game.naver.com/lounge/…/home"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="bg-panel border border-line rounded px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:border-accent transition-colors"
              />
            </label>
            <StatusMessage tone="error" className="text-sm">
              {error}
            </StatusMessage>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} disabled={saving} className="rounded px-3 py-2 text-sm text-muted hover:bg-ground transition-colors">
                취소
              </button>
              <button type="submit" disabled={saving} className="bg-accent text-white rounded px-4 py-2 text-sm hover:bg-accent/90 disabled:opacity-50 transition-colors">
                {saving ? "확인 중…" : "저장"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
```

`StatusMessage`의 `tone` prop이 `"error"`를 받는지 `components/ui/StatusMessage.tsx`에서 확인한다(GameForm은 `"success" | "warning" | "error"`를 넘긴다).

Run: `npx vitest run tests/components/LoungeConnectDialog.test.tsx` → PASS

- [ ] **Step 4: InboxNav 수정**

- import: `import LoungeConnectDialog from "@/components/inbox/LoungeConnectDialog";`
- props에 `loungeUnread = null,`과 타입 `loungeUnread?: number | null;` 추가.
- 운영 자료 `<Link>` 블록 바로 뒤에:

```tsx
      {game?.naverLoungeId && (
        <Link href={`/games/${game.id}/lounge`} className={`${ITEM} h-8 ${ITEM_IDLE} border border-line`}>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true">💬</span>
            <span>라운지 새 글</span>
          </span>
          {loungeUnread !== null && (
            <span className={`text-xs tabular-nums ${loungeUnread > 0 ? "text-accent font-semibold" : "text-muted font-normal"}`}>{loungeUnread}</span>
          )}
        </Link>
      )}
```

- 아래쪽 `{game && (...)}` 블록의 "답변 템플릿" `<Link>` 뒤에: `<LoungeConnectDialog gameId={game.id} loungeId={game.naverLoungeId ?? null} />`

- [ ] **Step 5: 데이터 연결**

`lib/inbox-page.ts`:
- import `import { countUnreadLoungeItems } from "@/lib/lounge-items";`
- `InboxPageData`에 `/** 네이버 라운지의 안 읽은 유저 글·댓글 수. 서비스 문의이거나 조회 실패면 null. */ loungeUnread: number | null;`
- 첫 `Promise.all` 배열 끝에 `gameId ? countUnreadLoungeItems(supabase, gameId) : Promise.resolve(null),`를 더하고 구조 분해에 `loungeUnreadRaw`를 더한다.
- 반환 직전: `const loungeUnread = game?.naverLoungeId ? loungeUnreadRaw : null;` 그리고 반환 객체에 `loungeUnread` 추가.

`components/inbox/InboxShell.tsx`: props에 `loungeUnread?: number | null`을 더해 `<InboxNav ... loungeUnread={loungeUnread} />`로 넘긴다. `InboxShell`을 렌더하는 페이지(`grep -rn "<InboxShell" app`)에서 `loungeUnread={data.loungeUnread}`를 넘긴다.

- [ ] **Step 6: 통과 확인**

Run: `npx vitest run tests/components/InboxNav.test.tsx tests/components/LoungeConnectDialog.test.tsx tests/lib/inbox-page.test.ts`
Expected: PASS. `inbox-page` 테스트가 있으면 가짜 Supabase에 `lounge_items` 분기가 없어 깨질 수 있다 — 그 가짜에 `lounge_items` → `{ count: 0, error: null }`을 돌려주는 분기를 더한다(파일이 없으면 이 파일은 건너뛴다).

- [ ] **Step 7: Commit**

```bash
git add components/inbox lib/inbox-page.ts app tests/components
git commit -m "feat: 문의함 보기 열에 라운지 새 글 링크와 연결 대화상자"
```

---

### Task 8: 라운지 목록 페이지와 읽음 처리

**Files:**
- Create: `app/(admin)/games/[gameId]/lounge/page.tsx`, `components/lounge/LoungeItemList.tsx`, `app/api/lounge/items/[id]/read/route.ts`, `app/api/games/[gameId]/lounge/read-all/route.ts`
- Test: `tests/components/LoungeItemList.test.tsx`, `tests/api/lounge-read.test.ts`

**Interfaces:**
- Consumes: `listLoungeItems`, `markLoungeItemRead`, `markAllLoungeItemsRead`, `LoungeItemRow`(Task 3).
- Produces: `POST /api/lounge/items/{id}/read`, `POST /api/games/{gameId}/lounge/read-all` → `{ success: true }` / 401 / 500 `save_failed`.

- [ ] **Step 1: 라우트 실패 테스트** (`tests/api/lounge-read.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as readOne } from "@/app/api/lounge/items/[id]/read/route";
import { POST as readAll } from "@/app/api/games/[gameId]/lounge/read-all/route";
import * as sessionModule from "@/lib/require-admin-session";
import * as itemsModule from "@/lib/lounge-items";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn(() => ({})) }));
vi.mock("@/lib/require-admin-session", () => ({ requireAdminSession: vi.fn() }));
vi.mock("@/lib/lounge-items", () => ({ markLoungeItemRead: vi.fn(), markAllLoungeItemsRead: vi.fn() }));

const req = () => new Request("https://admin.example/x", { method: "POST" });

describe("lounge read routes", () => {
  beforeEach(() => {
    vi.mocked(sessionModule.requireAdminSession).mockResolvedValue(true);
    vi.mocked(itemsModule.markLoungeItemRead).mockReset().mockResolvedValue(true);
    vi.mocked(itemsModule.markAllLoungeItemsRead).mockReset().mockResolvedValue(true);
  });

  it("requires an admin session", async () => {
    vi.mocked(sessionModule.requireAdminSession).mockResolvedValue(false);
    expect((await readOne(req(), { params: { id: "i1" } })).status).toBe(401);
    expect((await readAll(req(), { params: { gameId: "g1" } })).status).toBe(401);
    expect(itemsModule.markLoungeItemRead).not.toHaveBeenCalled();
  });

  it("marks one item and all items of a game as read", async () => {
    expect((await readOne(req(), { params: { id: "i1" } })).status).toBe(200);
    expect(itemsModule.markLoungeItemRead).toHaveBeenCalledWith(expect.anything(), "i1");
    expect((await readAll(req(), { params: { gameId: "g1" } })).status).toBe(200);
    expect(itemsModule.markAllLoungeItemsRead).toHaveBeenCalledWith(expect.anything(), "g1");
  });

  it("returns 500 when saving fails", async () => {
    vi.mocked(itemsModule.markLoungeItemRead).mockResolvedValue(false);
    expect((await readOne(req(), { params: { id: "i1" } })).status).toBe(500);
  });
});
```

Run: `npx vitest run tests/api/lounge-read.test.ts` → FAIL.

- [ ] **Step 2: 라우트 구현**

`app/api/lounge/items/[id]/read/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { markLoungeItemRead } from "@/lib/lounge-items";

/** 라운지 항목을 눌러 네이버로 넘어갈 때 읽음으로 바꾼다. */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }
  const ok = await markLoungeItemRead(getSupabaseServerClient(), params.id);
  return ok ? NextResponse.json({ success: true }) : NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
}
```

`app/api/games/[gameId]/lounge/read-all/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { markAllLoungeItemsRead } from "@/lib/lounge-items";

export async function POST(_request: Request, { params }: { params: { gameId: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }
  const ok = await markAllLoungeItemsRead(getSupabaseServerClient(), params.gameId);
  return ok ? NextResponse.json({ success: true }) : NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
}
```

Run: `npx vitest run tests/api/lounge-read.test.ts` → PASS

- [ ] **Step 3: 목록 컴포넌트 실패 테스트** (`tests/components/LoungeItemList.test.tsx`)

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoungeItemList from "@/components/lounge/LoungeItemList";
import type { LoungeItemRow } from "@/lib/lounge-items";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const item = (over: Partial<LoungeItemRow> = {}): LoungeItemRow => ({
  id: "i1", gameId: "g1", kind: "post", naverId: 100, feedId: 100, title: "질문 있어요", body: "본문", boardName: "자유", nickname: "유저1",
  isUser: true, url: "https://game.naver.com/lounge/L1/board/detail/100", postedAt: "2026-09-21T09:57:00.000Z", readAt: null, ...over,
});

describe("LoungeItemList", () => {
  beforeEach(() => {
    refresh.mockReset();
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true }) }) as never;
  });

  it("links each item to the lounge post in a new tab and marks it read on click", async () => {
    render(<LoungeItemList gameId="g1" items={[item(), item({ id: "i2", kind: "comment", naverId: 500, body: "댓글", readAt: "2026-09-21T10:00:00.000Z" })]} />);
    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", "https://game.naver.com/lounge/L1/board/detail/100");
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(within(links[0]).getByText("새 글")).toBeInTheDocument();
    expect(within(links[1]).getByText("댓글", { selector: "[data-kind]" })).toBeInTheDocument();
    expect(within(links[0]).getByText("안 읽음")).toBeInTheDocument();

    links[0].addEventListener("click", (event) => event.preventDefault());
    await userEvent.click(links[0]);
    expect(global.fetch).toHaveBeenCalledWith("/api/lounge/items/i1/read", { method: "POST" });
    expect(within(links[0]).queryByText("안 읽음")).not.toBeInTheDocument();
  });

  it("does not call the api for an item that is already read", async () => {
    render(<LoungeItemList gameId="g1" items={[item({ readAt: "2026-09-21T10:00:00.000Z" })]} />);
    const link = screen.getByRole("link");
    link.addEventListener("click", (event) => event.preventDefault());
    await userEvent.click(link);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("marks everything read", async () => {
    render(<LoungeItemList gameId="g1" items={[item()]} />);
    await userEvent.click(screen.getByRole("button", { name: "모두 읽음" }));
    expect(global.fetch).toHaveBeenCalledWith("/api/games/g1/lounge/read-all", { method: "POST" });
    expect(screen.queryByText("안 읽음")).not.toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("shows an empty state", () => {
    render(<LoungeItemList gameId="g1" items={[]} />);
    expect(screen.getByText(/아직 가져온 글이 없습니다/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "모두 읽음" })).not.toBeInTheDocument();
  });
});
```

Run: `npx vitest run tests/components/LoungeItemList.test.tsx` → FAIL.

- [ ] **Step 4: 목록 컴포넌트 구현** (`components/lounge/LoungeItemList.tsx`)

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { LoungeItemRow } from "@/lib/lounge-items";

const dateFormat = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" });

/**
 * 네이버 라운지에서 가져온 글·댓글 목록. 항목은 라운지의 그 글을 새 탭으로 여는 링크이고,
 * 누르는 순간 읽음으로 바꾼다(실패해도 이동은 막지 않는다).
 */
export default function LoungeItemList({ gameId, items }: { gameId: string; items: LoungeItemRow[] }) {
  const router = useRouter();
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set(items.filter((item) => item.readAt).map((item) => item.id)));
  const unreadCount = items.filter((item) => !readIds.has(item.id)).length;

  function markRead(id: string) {
    if (readIds.has(id)) return;
    setReadIds((prev) => new Set(prev).add(id));
    fetch(`/api/lounge/items/${id}/read`, { method: "POST" })
      .then(() => router.refresh())
      .catch(() => undefined);
  }

  async function markAllRead() {
    setReadIds(new Set(items.map((item) => item.id)));
    await fetch(`/api/games/${gameId}/lounge/read-all`, { method: "POST" }).catch(() => undefined);
    router.refresh();
  }

  if (items.length === 0) {
    return <p className="text-sm text-muted">아직 가져온 글이 없습니다. 라운지를 연결하면 5분 안에 첫 동기화가 돌고, 그 뒤에 올라오는 유저 글·댓글부터 알려드립니다.</p>;
  }

  return (
    <div className="flex flex-col gap-3 max-w-3xl">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">안 읽음 {unreadCount}건</p>
        {unreadCount > 0 && (
          <button type="button" onClick={markAllRead} className="text-sm rounded-lg border border-line px-3 py-1.5 hover:bg-ground transition-colors">
            모두 읽음
          </button>
        )}
      </div>
      <ul className="flex flex-col border border-line rounded-xl bg-panel divide-y divide-line overflow-hidden">
        {items.map((item) => {
          const unread = !readIds.has(item.id);
          return (
            <li key={item.id}>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => markRead(item.id)}
                onAuxClick={() => markRead(item.id)}
                className={`flex flex-col gap-1 px-4 py-3 hover:bg-ground transition-colors ${item.isUser ? "" : "opacity-60"}`}
              >
                <span className="flex items-center gap-2 text-xs text-muted">
                  <span data-kind={item.kind} className={`rounded px-1.5 py-0.5 font-medium ${item.kind === "post" ? "bg-emerald-100 text-emerald-700" : "bg-ground text-muted"}`}>
                    {item.kind === "post" ? "새 글" : "댓글"}
                  </span>
                  {item.boardName && <span>{item.boardName}</span>}
                  <span>{item.nickname ?? "알 수 없음"}{item.isUser ? "" : " · 운영자"}</span>
                  <time dateTime={item.postedAt}>{dateFormat.format(new Date(item.postedAt))}</time>
                  {unread && <span className="ml-auto rounded-full bg-accent/10 text-accent px-2 py-0.5 font-semibold">안 읽음</span>}
                </span>
                <span className={`text-sm truncate ${unread ? "font-semibold text-ink" : "text-ink"}`}>{item.title}</span>
                {item.body && <span className="text-[13px] text-muted line-clamp-2 whitespace-pre-line">{item.body}</span>}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

Run: `npx vitest run tests/components/LoungeItemList.test.tsx` → PASS

- [ ] **Step 5: 페이지** (`app/(admin)/games/[gameId]/lounge/page.tsx`) — 답변 템플릿 페이지와 같은 뼈대.

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { listGames } from "@/lib/categories";
import { listLoungeItems } from "@/lib/lounge-items";
import LoungeItemList from "@/components/lounge/LoungeItemList";

export const dynamic = "force-dynamic";

export default async function LoungePage({ params }: { params: { gameId: string } }) {
  const supabase = getSupabaseServerClient();
  const [games, items] = await Promise.all([listGames(supabase), listLoungeItems(supabase, params.gameId)]);

  const game = games.find((entry) => entry.id === params.gameId);
  if (!game) {
    notFound();
  }

  return (
    <div className="flex-1 overflow-y-auto px-8 py-6 flex flex-col gap-4">
      <Link href={`/games/${params.gameId}/inquiries`} className="text-sm text-muted hover:text-ink transition-colors">
        ← 문의함
      </Link>
      <header className="flex items-center gap-3">
        <h1 className="text-xl font-bold">{game.name}</h1>
        <span className="text-sm text-muted">네이버 라운지</span>
        {game.naverLoungeId && (
          <a
            href={`https://game.naver.com/lounge/${game.naverLoungeId}/home`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-sm rounded-lg border border-line px-3 py-1.5 hover:bg-ground transition-colors"
          >
            라운지 열기 <span aria-hidden="true">↗</span>
          </a>
        )}
      </header>
      {game.naverLoungeId ? (
        <LoungeItemList gameId={params.gameId} items={items} />
      ) : (
        <p className="text-sm text-muted">연결된 네이버 라운지가 없습니다. 문의함 왼쪽 아래의 &quot;네이버 라운지 연결&quot;에서 라운지 주소를 넣어주세요.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add "app/(admin)/games/[gameId]/lounge" app/api/lounge/items "app/api/games/[gameId]/lounge/read-all" components/lounge tests/api/lounge-read.test.ts tests/components/LoungeItemList.test.tsx
git commit -m "feat: 라운지 새 글 목록 페이지와 읽음 처리"
```

---

### Task 9: 게임 레일 배지

**Files:**
- Modify: `components/layout/GameRail.tsx`, `app/(admin)/layout.tsx`
- Test: `tests/components/GameRail.test.tsx`

**Interfaces:**
- Consumes: `countUnreadLoungeItemsByGame`(Task 3).
- Produces: `GameRail` prop `loungeCounts?: Record<string, number>`.

- [ ] **Step 1: 실패 테스트 추가**

```ts
  it("shows a separate lounge badge on the game tile", () => {
    render(<GameRail games={games} newCounts={{ g1: 2 }} loungeCounts={{ g1: 5 }} />);
    const tile = screen.getByRole("link", { name: /아르카나 사가/ });
    expect(within(tile).getByText("접수 2건")).toBeInTheDocument();
    expect(within(tile).getByText("라운지 새 글 5건")).toBeInTheDocument();
    expect(tile).toHaveAttribute("title", "아르카나 사가 · 접수 2건 · 라운지 새 글 5건");
    const other = screen.getByRole("link", { name: /여신의 검/ });
    expect(within(other).queryByText(/라운지 새 글/)).not.toBeInTheDocument();
  });
```

Run: `npx vitest run tests/components/GameRail.test.tsx` → 새 테스트 FAIL.

- [ ] **Step 2: 구현** (`components/layout/GameRail.tsx`)

`NewBadge` 아래에:

```tsx
/** 네이버 라운지의 안 읽은 유저 글·댓글. 접수 배지와 헷갈리지 않게 아래쪽 모서리에 네이버 초록으로 둔다. */
function LoungeBadge({ unread }: { unread: number }) {
  if (unread <= 0) return null;
  return (
    <span className="absolute -bottom-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#03C75A] text-white text-[10px] font-semibold leading-[18px] text-center ring-2 ring-panel tabular-nums">
      <span aria-hidden="true">{unread > 99 ? "99+" : unread}</span>
      <span className="sr-only">라운지 새 글 {unread}건</span>
    </span>
  );
}
```

props에 `loungeCounts = {},`와 타입 `/** 게임별 네이버 라운지 안 읽은 건수. */ loungeCounts?: Record<string, number>;` 추가. 게임 타일 map 안에서:

```tsx
            const loungeUnread = loungeCounts[game.id] ?? 0;
            const title = [game.name, pending > 0 ? `접수 ${pending}건` : null, loungeUnread > 0 ? `라운지 새 글 ${loungeUnread}건` : null].filter(Boolean).join(" · ");
```

`<Link>`의 `title={title}`로 바꾸고 `<NewBadge pending={pending} />` 뒤에 `<LoungeBadge unread={loungeUnread} />`.

`app/(admin)/layout.tsx`:

```tsx
import { countUnreadLoungeItemsByGame } from "@/lib/lounge-items";
// ...
  const [games, newCounts, loungeCounts] = await Promise.all([listGames(supabase), countNewInquiriesByGame(supabase), countUnreadLoungeItemsByGame(supabase)]);
// ...
      <GameRail games={games} newCounts={newCounts} loungeCounts={loungeCounts} />
```

- [ ] **Step 3: 통과 확인**

Run: `npx vitest run tests/components/GameRail.test.tsx`
Expected: PASS(기존 title 단언 포함)

- [ ] **Step 4: Commit**

```bash
git add components/layout/GameRail.tsx "app/(admin)/layout.tsx" tests/components/GameRail.test.tsx
git commit -m "feat: 게임 레일에 라운지 새 글 배지"
```

---

### Task 10: 문서와 전체 검증

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: `CLAUDE.md` 핵심 기능에 12번 추가** (11번 항목 뒤, "상세 설계는 …" 문단 앞)

```markdown
12. **네이버 라운지 새 글·댓글 알림** — 네이버 게임 라운지는 운영자에게 새 글 알림을 주지 않아서, 게임에 라운지를 연결해 두면(`games.naver_lounge_id`; 게임 추가 폼의 "네이버 라운지 주소" 또는 문의함 보기 열 아래 "네이버 라운지 연결" → `PATCH /api/games/{id}/lounge`, 둘 다 `lib/lounge-connect.ts`가 저장 전에 라운지를 한 번 읽어 확인) Supabase `pg_cron` 잡 `lounge-sync-run`이 5분마다 `/api/lounge/sync`를 부른다(마이그레이션 0024, 인증은 같은 `x-webhook-secret`). `lib/naver-lounge.ts`가 라운지 웹의 내부 API 두 개(글 목록 `comm-api.game.naver.com/.../lounge/{id}/feed`, 댓글 `apis.naver.com/nng_main/nng_comment_api/...`)를 로그인 없이 읽는다(2026-09-21 실측, 비공식이라 바뀌면 zod 검증이 던져 `fetch_failed`가 된다). `lib/lounge-sync.ts`는 최신 글 50건을 읽어 처음 보는 글을 `lounge_items`에 넣고, 저장해 둔 `comment_count`와 달라진 글만(한 번에 20개까지) 댓글·답글을 읽는다. 알림이 되는 것은 **유저(`common_user`)가 쓴 항목이면서 이전 동기화 뒤에 쓴 것**뿐이다 — GM 글·댓글도 저장하지만(공지에 달리는 유저 댓글을 잡으려면 댓글 수를 알아야 한다) 읽음으로 넣고, 첫 실행은 기준이 지금이라 기존 글이 전부 읽음이 된다. 라운지를 바꾸면 그 게임의 항목을 지우고 다시 시작한다. 관리자 화면: 보기 열의 "라운지 새 글 N" → `/games/{gameId}/lounge` 목록(항목을 누르면 라운지의 그 글이 새 탭으로 열리고 읽음 처리, "모두 읽음"), 게임 레일 타일 아래쪽의 초록 배지. Slack은 새 항목이 있는 게임마다 메시지 하나(초록 `#03C75A`, 5건까지 싣고 나머지는 "외 N건", `lib/slack.ts`의 `buildLoungeSlackMessage`)이며 실패해도 저장은 남는다. 한계: 최신 50건보다 오래된 글의 새 댓글, 한 글에서 5분 사이 30건을 넘긴 댓글은 놓친다.
```

"상세 설계는 …" 문단 끝에 `, 네이버 라운지 알림은 `docs/superpowers/specs/2026-09-21-naver-lounge-alerts-design.md``를 더한다.

- [ ] **Step 2: 설정 절차 섹션 추가** ("AI 답변 추천 설정 절차" 뒤, "컨벤션" 앞)

```markdown
## 네이버 라운지 알림 설정 절차

1. Supabase SQL Editor에서 `0024_naver_lounge.sql`을 실행한다. `games.naver_lounge_id`·`lounge_synced_at` 열, `lounge_items` 표를 만들고 `pg_cron` 잡 `lounge-sync-run`이 5분마다 `https://admin.theplayplus.com/api/lounge/sync`를 호출하게 등록한다. Vault의 `inquiry_webhook_secret`은 자동 답변 설정 때 넣은 것을 그대로 쓴다
2. 관리자 페이지 → 게임 문의함 → 왼쪽 아래 "네이버 라운지 연결"에 그 게임의 라운지 주소(`https://game.naver.com/lounge/{라운지ID}/home`)를 붙여넣는다. 새 게임은 "게임 추가" 대화상자에서 바로 넣을 수 있다. 게임마다 라운지가 다르므로 게임별로 한 번씩 한다
3. 첫 동기화(5분 안)는 기존 글·댓글을 전부 읽음으로 가져온다. 그 뒤 일반 계정으로 라운지에 테스트 글이나 댓글을 쓰고 5분 안에 보기 열 "라운지 새 글" 건수, 게임 레일 초록 배지, Slack 메시지가 오는지 확인한다(GM 계정으로 쓴 글은 알림이 안 된다). 실행 기록은 `select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'lounge-sync-run') order by start_time desc limit 20;`
```

- [ ] **Step 3: 전체 테스트·타입·빌드**

Run: `npx vitest run`
Expected: 전부 PASS.

Run: `npx tsc --noEmit`
Expected: 오류 없음. `GameRow` 리터럴을 쓰는 테스트 fixture는 `naverLoungeId`가 optional이라 그대로 통과한다.

Run: `npm run build`
Expected: 빌드 성공, 라우트 목록에 `/api/lounge/sync`, `/games/[gameId]/lounge`가 보인다.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: 네이버 라운지 알림 기능과 설정 절차"
```
