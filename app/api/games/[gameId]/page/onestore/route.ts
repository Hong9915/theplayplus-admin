import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { importOneStoreImages } from "@/lib/game-page-import";
import { OneStoreNotFoundError, fetchOneStoreProduct, parseOneStoreProductId } from "@/lib/onestore";

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

  const images = parsed.data.images
    ? await importOneStoreImages(getSupabaseServerClient(), params.gameId, product)
    : { card: false, screenshots: 0 };

  return NextResponse.json({
    success: true,
    product: {
      url: product.url,
      title: product.title,
      genre: product.genre,
      ageRating: product.ageRating,
      tagline: product.tagline,
      description: product.description,
      youtubeUrl: product.youtubeUrl,
    },
    imported: { card: images.card, screenshots: images.screenshots },
    ...("warning" in images && images.warning ? { warning: images.warning } : {}),
  });
}
