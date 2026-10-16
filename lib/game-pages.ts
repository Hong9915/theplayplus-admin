import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/** 웹사이트 게임 페이지(game_pages, 마이그레이션 0026). 게임당 한 행. */
export const RELEASE_STATUSES = ["live", "prereg", "upcoming"] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

export const RELEASE_STATUS_LABELS: Record<ReleaseStatus, string> = {
  live: "서비스 중",
  prereg: "사전예약 중",
  upcoming: "출시 예정",
};

export const NOTICE_CATEGORIES = ["notice", "maintenance", "update", "event"] as const;
export type NoticeCategory = (typeof NOTICE_CATEGORIES)[number];

export const NOTICE_CATEGORY_LABELS: Record<NoticeCategory, string> = {
  notice: "공지",
  maintenance: "점검",
  update: "업데이트",
  event: "이벤트",
};

export const IMAGE_KINDS = ["kv", "card", "screenshot"] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

export const MAX_SCREENSHOTS = 10;
/** Vercel 요청 본문 상한(4.5MB) 아래로 둔다. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** 화면 폼과 API가 주고받는 텍스트 항목. 빈 칸은 ""로 오고 DB에는 null로 들어간다. */
const TEXT_FIELDS = [
  "titleKo",
  "titleZh",
  "titleEn",
  "genreKo",
  "genreZh",
  "genreEn",
  "taglineKo",
  "taglineZh",
  "taglineEn",
  "descriptionKo",
  "descriptionZh",
  "descriptionEn",
  "ageRating",
  "developer",
  "onestoreUrl",
  "googlePlayUrl",
  "appStoreUrl",
  "naverLoungeUrl",
  "youtubeId",
  "probabilityUrl",
] as const;
type TextField = (typeof TEXT_FIELDS)[number];

export type GamePageText = Record<TextField, string>;

export interface GamePage extends GamePageText {
  gameId: string;
  published: boolean;
  slug: string;
  releaseStatus: ReleaseStatus;
  sortOrder: number;
  kvPath: string | null;
  cardPath: string | null;
  screenshotPaths: string[];
  updatedAt: string | null;
}

export interface GameNotice {
  id: string;
  gameId: string;
  category: NoticeCategory;
  title: string;
  body: string;
  pinned: boolean;
  publishedAt: string;
}

const COLUMN: Record<TextField, string> = {
  titleKo: "title_ko",
  titleZh: "title_zh",
  titleEn: "title_en",
  genreKo: "genre_ko",
  genreZh: "genre_zh",
  genreEn: "genre_en",
  taglineKo: "tagline_ko",
  taglineZh: "tagline_zh",
  taglineEn: "tagline_en",
  descriptionKo: "description_ko",
  descriptionZh: "description_zh",
  descriptionEn: "description_en",
  ageRating: "age_rating",
  developer: "developer",
  onestoreUrl: "onestore_url",
  googlePlayUrl: "google_play_url",
  appStoreUrl: "app_store_url",
  naverLoungeUrl: "naver_lounge_url",
  youtubeId: "youtube_id",
  probabilityUrl: "probability_url",
};

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine((value) => value === "" || /^https?:\/\/\S+$/.test(value), "url");

const shortText = z.string().trim().max(200);
const longText = z.string().max(10000);

export const gamePageSchema = z
  .object({
    published: z.boolean(),
    slug: z
      .string()
      .trim()
      .max(60)
      .refine((value) => value === "" || /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value), "slug"),
    releaseStatus: z.enum(RELEASE_STATUSES),
    sortOrder: z.number().int().min(-999).max(999),
    titleKo: shortText,
    titleZh: shortText,
    titleEn: shortText,
    genreKo: shortText,
    genreZh: shortText,
    genreEn: shortText,
    taglineKo: shortText,
    taglineZh: shortText,
    taglineEn: shortText,
    descriptionKo: longText,
    descriptionZh: longText,
    descriptionEn: longText,
    ageRating: shortText,
    developer: shortText,
    onestoreUrl: httpUrl,
    googlePlayUrl: httpUrl,
    appStoreUrl: httpUrl,
    naverLoungeUrl: httpUrl,
    youtubeId: z
      .string()
      .trim()
      .max(20)
      .refine((value) => value === "" || /^[A-Za-z0-9_-]+$/.test(value), "youtube"),
    probabilityUrl: httpUrl,
  })
  // 공개하려면 주소와 한국어 제목은 있어야 한다. 나머지는 비어 있으면 웹에서 그 칸을 숨긴다.
  .superRefine((value, ctx) => {
    if (!value.published) return;
    if (value.slug === "") ctx.addIssue({ code: "custom", path: ["slug"], message: "required_to_publish" });
    if (value.titleKo.trim() === "") ctx.addIssue({ code: "custom", path: ["titleKo"], message: "required_to_publish" });
  });

export type GamePageInput = z.infer<typeof gamePageSchema>;

export const noticeSchema = z.object({
  category: z.enum(NOTICE_CATEGORIES),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20000),
  pinned: z.boolean(),
  /** 게시일. 비우면 지금. 예약 게시용으로 미래 시각도 받는다. */
  publishedAt: z.string().datetime({ offset: true }).nullable(),
});

export type NoticeInput = z.infer<typeof noticeSchema>;

type Row = Record<string, unknown>;

const PAGE_COLUMNS = [
  "game_id",
  "published",
  "slug",
  "release_status",
  "sort_order",
  ...Object.values(COLUMN),
  "kv_path",
  "card_path",
  "screenshot_paths",
  "updated_at",
].join(", ");

export function emptyGamePage(gameId: string, gameName = ""): GamePage {
  const text = Object.fromEntries(TEXT_FIELDS.map((field) => [field, ""])) as GamePageText;
  return {
    ...text,
    titleKo: gameName,
    gameId,
    published: false,
    slug: "",
    releaseStatus: "upcoming",
    sortOrder: 0,
    kvPath: null,
    cardPath: null,
    screenshotPaths: [],
    updatedAt: null,
  };
}

export function mapGamePageRow(row: Row): GamePage {
  const text = Object.fromEntries(
    TEXT_FIELDS.map((field) => [field, (row[COLUMN[field]] as string | null) ?? ""])
  ) as GamePageText;
  return {
    ...text,
    gameId: row.game_id as string,
    published: Boolean(row.published),
    slug: (row.slug as string | null) ?? "",
    releaseStatus: row.release_status as ReleaseStatus,
    sortOrder: (row.sort_order as number | null) ?? 0,
    kvPath: (row.kv_path as string | null) ?? null,
    cardPath: (row.card_path as string | null) ?? null,
    screenshotPaths: (row.screenshot_paths as string[] | null) ?? [],
    updatedAt: (row.updated_at as string | null) ?? null,
  };
}

/** 폼 값을 DB 열로. 빈 문자열은 null로 저장해 웹이 "값 없음"으로 판단하게 한다. */
export function toGamePageColumns(input: GamePageInput): Row {
  const columns: Row = {
    published: input.published,
    slug: input.slug === "" ? null : input.slug,
    release_status: input.releaseStatus,
    sort_order: input.sortOrder,
    updated_at: new Date().toISOString(),
  };
  for (const field of TEXT_FIELDS) {
    const value = input[field];
    columns[COLUMN[field]] = value.trim() === "" ? null : value;
  }
  return columns;
}

export async function getGamePage(supabase: SupabaseClient, gameId: string): Promise<GamePage | null> {
  const { data, error } = await supabase.from("game_pages").select(PAGE_COLUMNS).eq("game_id", gameId).maybeSingle();
  if (error || !data) return null;
  return mapGamePageRow(data as unknown as Row);
}

export type SaveResult = { ok: true; page: GamePage } | { ok: false; error: "slug_taken" | "save_failed" };

export async function saveGamePage(
  supabase: SupabaseClient,
  gameId: string,
  input: GamePageInput
): Promise<SaveResult> {
  const { data, error } = await supabase
    .from("game_pages")
    .upsert({ game_id: gameId, ...toGamePageColumns(input) }, { onConflict: "game_id" })
    .select(PAGE_COLUMNS)
    .single();

  if (error || !data) {
    // 23505: unique_violation — 다른 게임이 이미 쓰는 주소.
    if (error?.code === "23505") return { ok: false, error: "slug_taken" };
    console.error("[game-pages] save failed", { gameId, message: error?.message });
    return { ok: false, error: "save_failed" };
  }
  return { ok: true, page: mapGamePageRow(data as unknown as Row) };
}

/** 이미지 경로만 바꾼다. 행이 없으면 만든다(공개는 꺼진 채로). */
export async function setGamePageImages(
  supabase: SupabaseClient,
  gameId: string,
  patch: { kv_path?: string | null; card_path?: string | null; screenshot_paths?: string[] }
): Promise<boolean> {
  const { error } = await supabase
    .from("game_pages")
    .upsert({ game_id: gameId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "game_id" });
  if (error) {
    console.error("[game-pages] image update failed", { gameId, message: error.message });
    return false;
  }
  return true;
}

/** game-site 버킷 공개 주소. '/'로 시작하는 경로는 웹사이트 public 폴더 파일이라 그대로 둔다. */
export function getGameSiteImageUrl(path: string | null): string | null {
  if (!path) return null;
  if (path.startsWith("/") || /^https?:\/\//.test(path)) return path;
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!baseUrl) return null;
  return `${baseUrl}/storage/v1/object/public/game-site/${path}`;
}

/** 버킷에 올린 파일인지. 웹사이트 public 폴더 경로는 지울 대상이 아니다. */
export function isStoragePath(path: string | null): path is string {
  return Boolean(path) && !path!.startsWith("/") && !/^https?:\/\//.test(path!);
}

function mapNoticeRow(row: Row): GameNotice {
  return {
    id: row.id as string,
    gameId: row.game_id as string,
    category: row.category as NoticeCategory,
    title: row.title as string,
    body: row.body as string,
    pinned: Boolean(row.pinned),
    publishedAt: row.published_at as string,
  };
}

const NOTICE_COLUMNS = "id, game_id, category, title, body, pinned, published_at";

export async function listNotices(supabase: SupabaseClient, gameId: string): Promise<GameNotice[]> {
  const { data, error } = await supabase
    .from("game_notices")
    .select(NOTICE_COLUMNS)
    .eq("game_id", gameId)
    .order("pinned", { ascending: false })
    .order("published_at", { ascending: false });
  if (error || !data) return [];
  return (data as unknown as Row[]).map(mapNoticeRow);
}

function toNoticeColumns(input: NoticeInput): Row {
  return {
    category: input.category,
    title: input.title,
    body: input.body,
    pinned: input.pinned,
    ...(input.publishedAt ? { published_at: input.publishedAt } : {}),
    updated_at: new Date().toISOString(),
  };
}

export async function createNotice(supabase: SupabaseClient, gameId: string, input: NoticeInput): Promise<boolean> {
  const { error } = await supabase.from("game_notices").insert({ game_id: gameId, ...toNoticeColumns(input) });
  if (error) {
    console.error("[game-pages] notice create failed", { gameId, message: error.message });
    return false;
  }
  return true;
}

export async function updateNotice(supabase: SupabaseClient, id: string, input: NoticeInput): Promise<boolean> {
  const { error } = await supabase.from("game_notices").update(toNoticeColumns(input)).eq("id", id);
  if (error) {
    console.error("[game-pages] notice update failed", { id, message: error.message });
    return false;
  }
  return true;
}

export async function deleteNotice(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { error } = await supabase.from("game_notices").delete().eq("id", id);
  if (error) {
    console.error("[game-pages] notice delete failed", { id, message: error.message });
    return false;
  }
  return true;
}
