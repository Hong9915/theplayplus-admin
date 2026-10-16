import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { buildGameLogoPath } from "@/lib/storage";
import {
  MAX_IMAGE_BYTES,
  MAX_SCREENSHOTS,
  emptyGamePage,
  getGamePage,
  isStoragePath,
  setGamePageImages,
} from "@/lib/game-pages";
import {
  OneStoreNotFoundError,
  downloadOneStoreImage,
  fetchOneStoreProduct,
  parseOneStoreProductId,
} from "@/lib/onestore";

const BUCKET = "game-site";
export const maxDuration = 60;

const bodySchema = z.object({ url: z.string().trim().min(1).max(500), images: z.boolean() });

/**
 * 원스토어 상품 페이지에서 글을 읽어 돌려준다(저장은 화면에서 "저장"을 눌러야 한다).
 * images 가 true면 스크린샷과 대표 이미지(목록 카드)를 받아 game-site 버킷에 바로 저장하고
 * 기존 스크린샷·카드를 교체한다.
 */
export async function POST(request: Request, { params }: { params: { gameId: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  const productId = parsed.success ? parseOneStoreProductId(parsed.data.url) : null;
  if (!parsed.success || !productId) {
    return NextResponse.json({ success: false, error: "invalid_url" }, { status: 400 });
  }

  let product;
  try {
    product = await fetchOneStoreProduct(productId);
  } catch (error) {
    if (error instanceof OneStoreNotFoundError) {
      return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
    }
    console.error("[api/page/onestore] fetch failed", { productId, error });
    return NextResponse.json({ success: false, error: "fetch_failed" }, { status: 502 });
  }

  const imported = { card: false, screenshots: 0 };
  let warning: string | undefined;

  if (parsed.data.images) {
    const supabase = getSupabaseServerClient();
    const page = (await getGamePage(supabase, params.gameId)) ?? emptyGamePage(params.gameId);

    const upload = async (url: string): Promise<string | null> => {
      try {
        const image = await downloadOneStoreImage(url, MAX_IMAGE_BYTES);
        if (!image) return null;
        const path = buildGameLogoPath(params.gameId, image.fileName, randomUUID());
        const { error } = await supabase.storage.from(BUCKET).upload(path, image.data, { contentType: image.contentType });
        return error ? null : path;
      } catch {
        return null;
      }
    };

    const [cardPath, ...shotPaths] = await Promise.all([
      product.promoImageUrl ? upload(product.promoImageUrl) : Promise.resolve(null),
      ...product.screenshotUrls.slice(0, MAX_SCREENSHOTS).map(upload),
    ]);
    const screenshots = shotPaths.filter((path): path is string => path !== null);
    const expected = (product.promoImageUrl ? 1 : 0) + Math.min(product.screenshotUrls.length, MAX_SCREENSHOTS);
    if ((cardPath ? 1 : 0) + screenshots.length < expected) warning = "some_images_failed";

    const patch: { card_path?: string; screenshot_paths?: string[] } = {};
    if (cardPath) patch.card_path = cardPath;
    if (screenshots.length > 0) patch.screenshot_paths = screenshots;

    if (Object.keys(patch).length > 0) {
      if (!(await setGamePageImages(supabase, params.gameId, patch))) {
        const uploaded = [cardPath, ...screenshots].filter((path): path is string => path !== null);
        await supabase.storage.from(BUCKET).remove(uploaded);
        warning = "images_not_saved";
      } else {
        imported.card = Boolean(cardPath);
        imported.screenshots = screenshots.length;
        // 교체된 옛 파일 정리. 실패해도 괜찮다.
        const replaced = [
          ...(cardPath ? [page.cardPath] : []),
          ...(screenshots.length > 0 ? page.screenshotPaths : []),
        ].filter(isStoragePath);
        if (replaced.length > 0) await supabase.storage.from(BUCKET).remove(replaced);
      }
    }
  }

  return NextResponse.json({
    success: true,
    product: {
      url: product.url,
      title: product.title,
      genre: product.genre,
      ageRating: product.ageRating,
      tagline: product.tagline,
      description: product.description,
    },
    imported,
    ...(warning ? { warning } : {}),
  });
}
