import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { buildGameLogoPath } from "@/lib/storage";
import {
  MAX_IMAGE_BYTES,
  MAX_SCREENSHOTS,
  emptyGamePage,
  getGamePage,
  isStoragePath,
  saveGamePage,
  setGamePageImages,
} from "@/lib/game-pages";
import { downloadOneStoreImage, fetchOneStoreProduct, parseOneStoreProductId, type OneStoreProduct } from "@/lib/onestore";
import type { GameSiteFormInput } from "@/lib/game-schema";

const BUCKET = "game-site";

export interface ImportedImages {
  card: boolean;
  screenshots: number;
  /** 하나라도 못 가져왔거나 저장하지 못했으면 경고 코드. */
  warning?: "some_images_failed" | "images_not_saved";
}

/**
 * 원스토어 스크린샷(최대 10장)과 대표 이미지(목록 카드)를 받아 game-site 버킷에 올리고
 * game_pages 에 바로 저장한다. 기존 스크린샷·카드는 교체하고 옛 파일은 지운다.
 * "원스토어에서 불러오기" 버튼과 게임 추가가 함께 쓴다.
 */
export async function importOneStoreImages(
  supabase: SupabaseClient,
  gameId: string,
  product: Pick<OneStoreProduct, "promoImageUrl" | "screenshotUrls">
): Promise<ImportedImages> {
  const page = (await getGamePage(supabase, gameId)) ?? emptyGamePage(gameId);

  const upload = async (url: string): Promise<string | null> => {
    try {
      const image = await downloadOneStoreImage(url, MAX_IMAGE_BYTES);
      if (!image) return null;
      const path = buildGameLogoPath(gameId, image.fileName, randomUUID());
      const { error } = await supabase.storage.from(BUCKET).upload(path, image.data, { contentType: image.contentType });
      return error ? null : path;
    } catch {
      return null;
    }
  };

  const shots = product.screenshotUrls.slice(0, MAX_SCREENSHOTS);
  const [cardPath, ...shotPaths] = await Promise.all([
    product.promoImageUrl ? upload(product.promoImageUrl) : Promise.resolve(null),
    ...shots.map(upload),
  ]);
  const screenshots = shotPaths.filter((path): path is string => path !== null);
  const expected = (product.promoImageUrl ? 1 : 0) + shots.length;
  let warning: ImportedImages["warning"] = (cardPath ? 1 : 0) + screenshots.length < expected ? "some_images_failed" : undefined;

  const patch: { card_path?: string; screenshot_paths?: string[] } = {};
  if (cardPath) patch.card_path = cardPath;
  if (screenshots.length > 0) patch.screenshot_paths = screenshots;
  if (Object.keys(patch).length === 0) return { card: false, screenshots: 0, warning };

  if (!(await setGamePageImages(supabase, gameId, patch))) {
    await supabase.storage.from(BUCKET).remove([cardPath, ...screenshots].filter((path): path is string => path !== null));
    return { card: false, screenshots: 0, warning: "images_not_saved" };
  }

  // 교체된 옛 파일 정리. 실패해도 괜찮다.
  const replaced = [...(cardPath ? [page.cardPath] : []), ...(screenshots.length > 0 ? page.screenshotPaths : [])].filter(isStoragePath);
  if (replaced.length > 0) await supabase.storage.from(BUCKET).remove(replaced);

  return { card: Boolean(cardPath), screenshots: screenshots.length, ...(warning ? { warning } : {}) };
}

/** 게임 추가 폼의 웹사이트 칸이 하나라도 채워졌는지. 비어 있으면 game_pages 를 만들지 않는다. */
export function hasSiteInput(site: GameSiteFormInput): boolean {
  return site.published || site.onestoreSync || [site.onestoreUrl, site.googlePlayUrl, site.appStoreUrl, site.slug].some((value) => value !== "");
}

export type NewGameSiteWarning = "site_onestore_failed" | "site_slug_taken" | "site_page_failed" | "site_images_failed";

/**
 * 게임 추가 때 웹사이트 게임 페이지도 만든다. 원스토어 주소가 있으면 제목·장르·이용등급·한 줄 소개·
 * 게임 소개와 스크린샷·대표 이미지를 원스토어에서 채운다. 부가 작업이라 실패해도 게임은 그대로 두고
 * 경고 코드만 돌려준다 — 나머지는 "웹사이트 게임 페이지" 화면에서 고칠 수 있다.
 */
export async function createSitePageForNewGame(
  supabase: SupabaseClient,
  gameId: string,
  gameName: string,
  site: GameSiteFormInput
): Promise<NewGameSiteWarning | undefined> {
  let product: OneStoreProduct | null = null;
  let warning: NewGameSiteWarning | undefined;
  const productId = site.onestoreUrl ? parseOneStoreProductId(site.onestoreUrl) : null;
  if (productId) {
    try {
      product = await fetchOneStoreProduct(productId);
    } catch (error) {
      console.error("[game-page-import] onestore read failed", { gameId, productId, error });
      warning = "site_onestore_failed";
    }
  }

  const page = emptyGamePage(gameId, gameName);
  const { gameId: _id, kvPath: _kv, cardPath: _card, screenshotPaths: _shots, updatedAt: _updated, ...input } = page;
  const saved = await saveGamePage(supabase, gameId, {
    ...input,
    published: site.published,
    onestoreSync: site.onestoreSync,
    slug: site.slug,
    releaseStatus: site.releaseStatus,
    titleKo: product?.title ?? gameName,
    genreKo: product?.genre ?? "",
    ageRating: product?.ageRating ?? "",
    taglineKo: product?.tagline ?? "",
    descriptionKo: product?.description ?? "",
    onestoreUrl: product?.url ?? site.onestoreUrl,
    googlePlayUrl: site.googlePlayUrl,
    appStoreUrl: site.appStoreUrl,
  });
  if (!saved.ok) return saved.error === "slug_taken" ? "site_slug_taken" : "site_page_failed";

  if (product) {
    const images = await importOneStoreImages(supabase, gameId, product);
    if (images.warning) warning = warning ?? "site_images_failed";
  }
  return warning;
}
