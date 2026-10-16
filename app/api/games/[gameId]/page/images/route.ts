import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { buildGameLogoPath } from "@/lib/storage";
import {
  IMAGE_KINDS,
  MAX_IMAGE_BYTES,
  MAX_SCREENSHOTS,
  emptyGamePage,
  getGamePage,
  isStoragePath,
  setGamePageImages,
  type ImageKind,
} from "@/lib/game-pages";

const BUCKET = "game-site";

const kindSchema = z.enum(IMAGE_KINDS);

function unauthorized() {
  return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
}

/** 이미지 한 장을 올린다. 키 비주얼·카드는 교체, 스크린샷은 뒤에 붙인다. */
export async function POST(request: Request, { params }: { params: { gameId: string } }) {
  if (!(await requireAdminSession())) return unauthorized();

  const formData = await request.formData();
  const kind = kindSchema.safeParse(formData.get("kind"));
  const file = formData.get("file");
  if (!kind.success || !(file instanceof File) || file.size === 0) {
    return NextResponse.json({ success: false, error: "invalid_input" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ success: false, error: "not_image" }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ success: false, error: "too_large" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const page = (await getGamePage(supabase, params.gameId)) ?? emptyGamePage(params.gameId);
  if (kind.data === "screenshot" && page.screenshotPaths.length >= MAX_SCREENSHOTS) {
    return NextResponse.json({ success: false, error: "too_many" }, { status: 400 });
  }

  // 한글 파일명은 Storage 키로 쓸 수 없어 로고와 같은 규칙으로 바꾼다.
  const path = buildGameLogoPath(params.gameId, file.name, randomUUID());
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || undefined });
  if (uploadError) {
    console.error("[api/page/images] upload failed", { path, message: uploadError.message });
    return NextResponse.json({ success: false, error: "upload_failed" }, { status: 500 });
  }

  const previous = kind.data === "kv" ? page.kvPath : kind.data === "card" ? page.cardPath : null;
  const saved = await setGamePageImages(supabase, params.gameId, patchFor(kind.data, path, page.screenshotPaths));
  if (!saved) {
    await supabase.storage.from(BUCKET).remove([path]);
    return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
  }

  // 교체된 옛 파일 정리는 실패해도 괜찮다.
  if (isStoragePath(previous)) {
    await supabase.storage.from(BUCKET).remove([previous]);
  }

  return NextResponse.json({ success: true, path });
}

function patchFor(kind: ImageKind, path: string, screenshots: string[]) {
  if (kind === "kv") return { kv_path: path };
  if (kind === "card") return { card_path: path };
  return { screenshot_paths: [...screenshots, path] };
}

const deleteSchema = z.object({ kind: kindSchema, path: z.string().min(1) });

export async function DELETE(request: Request, { params }: { params: { gameId: string } }) {
  if (!(await requireAdminSession())) return unauthorized();

  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_input" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const page = await getGamePage(supabase, params.gameId);
  if (!page) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }

  const { kind, path } = parsed.data;
  const current = kind === "kv" ? page.kvPath : kind === "card" ? page.cardPath : null;
  if (kind !== "screenshot" && current !== path) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }
  if (kind === "screenshot" && !page.screenshotPaths.includes(path)) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }

  const patch =
    kind === "kv"
      ? { kv_path: null }
      : kind === "card"
        ? { card_path: null }
        : { screenshot_paths: page.screenshotPaths.filter((entry) => entry !== path) };
  if (!(await setGamePageImages(supabase, params.gameId, patch))) {
    return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
  }

  if (isStoragePath(path)) {
    await supabase.storage.from(BUCKET).remove([path]);
  }

  return NextResponse.json({ success: true });
}
