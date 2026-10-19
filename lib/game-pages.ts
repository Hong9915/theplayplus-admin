import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { parseYouTubeId, youtubeWatchUrl } from "@/lib/youtube";

/** 웹사이트 게임 페이지(game_pages, 마이그레이션 0026). 게임당 한 행. */
export const RELEASE_STATUSES = ["live", "prereg", "upcoming"] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

export const RELEASE_STATUS_LABELS: Record<ReleaseStatus, string> = {
  live: "서비스 중",
  prereg: "사전예약 중",
  upcoming: "출시 예정",
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
  "releaseDate",
  "preregPeriod",
  "onestoreUrl",
  "googlePlayUrl",
  "appStoreUrl",
  "youtubeUrl",
  "probabilityUrl",
] as const;
type TextField = (typeof TEXT_FIELDS)[number];

export type GamePageText = Record<TextField, string>;

export interface GamePage extends GamePageText {
  gameId: string;
  published: boolean;
  /** 켜면 웹사이트가 원스토어를 직접 읽어 제목·장르·이용등급·게임 소개·스크린샷을 보여준다. */
  onestoreSync: boolean;
  slug: string;
  releaseStatus: ReleaseStatus;
  sortOrder: number;
  kvPath: string | null;
  cardPath: string | null;
  screenshotPaths: string[];
  updatedAt: string | null;
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
  releaseDate: "release_date",
  preregPeriod: "prereg_period",
  onestoreUrl: "onestore_url",
  googlePlayUrl: "google_play_url",
  appStoreUrl: "app_store_url",
  // 화면에서는 주소로 받고, DB에는 웹사이트가 쓰는 영상 ID만 저장한다.
  youtubeUrl: "youtube_id",
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
    onestoreSync: z.boolean(),
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
    releaseDate: shortText,
    preregPeriod: shortText,
    onestoreUrl: httpUrl,
    googlePlayUrl: httpUrl,
    appStoreUrl: httpUrl,
    youtubeUrl: z
      .string()
      .trim()
      .max(500)
      .refine((value) => value === "" || parseYouTubeId(value) !== null, "youtube"),
    probabilityUrl: httpUrl,
  })
  // 공개하려면 주소와 한국어 제목은 있어야 한다. 나머지는 비어 있으면 웹에서 그 칸을 숨긴다.
  .superRefine((value, ctx) => {
    if (!value.published) return;
    if (value.slug === "") ctx.addIssue({ code: "custom", path: ["slug"], message: "required_to_publish" });
    if (value.titleKo.trim() === "") ctx.addIssue({ code: "custom", path: ["titleKo"], message: "required_to_publish" });
  })
  // 자동 반영은 읽어 올 원스토어 주소가 있어야 한다.
  .superRefine((value, ctx) => {
    if (value.onestoreSync && value.onestoreUrl.trim() === "") {
      ctx.addIssue({ code: "custom", path: ["onestoreUrl"], message: "required_to_sync" });
    }
  });

export type GamePageInput = z.infer<typeof gamePageSchema>;

type Row = Record<string, unknown>;

const PAGE_COLUMNS = [
  "game_id",
  "published",
  "onestore_sync",
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
    onestoreSync: false,
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
  if (text.youtubeUrl !== "") text.youtubeUrl = youtubeWatchUrl(text.youtubeUrl);
  return {
    ...text,
    gameId: row.game_id as string,
    published: Boolean(row.published),
    onestoreSync: Boolean(row.onestore_sync),
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
    onestore_sync: input.onestoreSync,
    slug: input.slug === "" ? null : input.slug,
    release_status: input.releaseStatus,
    sort_order: input.sortOrder,
    updated_at: new Date().toISOString(),
  };
  for (const field of TEXT_FIELDS) {
    const value = input[field];
    columns[COLUMN[field]] = value.trim() === "" ? null : value;
  }
  columns[COLUMN.youtubeUrl] = parseYouTubeId(input.youtubeUrl);
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
