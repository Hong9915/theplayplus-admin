import { z } from "zod";

/**
 * 네이버 게임 라운지 읽기. 라운지 웹이 쓰는 내부 API를 로그인 없이 부른다(2026-09-21 실측).
 * 공식 API가 아니라 예고 없이 바뀔 수 있으므로, 응답 모양이 다르면 조용히 넘기지 않고 던져서
 * 동기화가 fetch_failed로 기록하게 한다. 외부 API를 아는 파일은 여기 하나다.
 */

const FEED_BASE = "https://comm-api.game.naver.com/nng_main/v1/community/lounge";
const COMMENT_BASE = "https://apis.naver.com/nng_main/nng_comment_api/v1";
const POST_LIMIT = 30; // API는 30 초과 시 400을 돌려준다 (2026-09-21 실측).
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

const MAX_CODE_POINT = 0x10ffff;

/** 유니코드 범위를 벗어난 값은 String.fromCodePoint가 던진다. 제목 한 줄 때문에 게임 전체가 실패하지 않게 원문을 둔다. */
function fromCodePoint(code: number, whole: string): string {
  return Number.isInteger(code) && code >= 0 && code <= MAX_CODE_POINT ? String.fromCodePoint(code) : whole;
}

/** 제목은 이모지 등이 `&#x1f430;` 꼴로 온다. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x")) return fromCodePoint(parseInt(body.slice(2), 16), whole);
    if (body.startsWith("#")) return fromCodePoint(parseInt(body.slice(1), 10), whole);
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

/**
 * 글 주소는 관리자 화면과 Slack에서 그대로 링크가 되므로 `https://`로 시작할 때만 쓴다.
 * 아니면 그 라운지 홈으로 보낸다(주소 없이 저장할 수는 없다 — `lounge_items.url`은 not null).
 */
function safePostUrl(pc: string, loungeId: string): string {
  return pc.startsWith("https://") ? pc : `https://game.naver.com/lounge/${loungeId}`;
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`naver lounge request failed: ${response.status}`);
  }
  return response.json();
}

/** 최신 글 30건. */
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
    url: safePostUrl(entry.feedLink.pc, loungeId),
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
