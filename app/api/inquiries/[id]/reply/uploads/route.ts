import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import {
  ATTACHMENT_BUCKET,
  isAllowedImageType,
  MAX_IMAGE_BYTES,
  MAX_REPLY_IMAGES,
  MAX_REPLY_TOTAL_BYTES,
  messageAttachmentPath,
  safeFileName,
} from "@/lib/attachment-rules";

/**
 * 답변에 붙일 사진의 서명 업로드 주소를 내준다. 사진은 Vercel 함수 본문 제한(4.5MB)을
 * 넘기 쉬워 브라우저가 이 주소로 버킷에 바로 올리고, 발송할 때 경로만 보낸다.
 * 경로는 서버가 정하고 문의 id 아래에 둔다 — 발송 라우트가 그 접두어를 확인한다.
 */
const uploadSchema = z.object({
  files: z
    .array(
      z.object({
        name: z.string().max(300),
        type: z.string().max(100),
        size: z.number().int().positive(),
      })
    )
    .min(1)
    .max(MAX_REPLY_IMAGES),
});

export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const parsed = uploadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_input" }, { status: 400 });
  }
  const files = parsed.data.files;
  for (const file of files) {
    if (!isAllowedImageType(file.type)) {
      return NextResponse.json({ success: false, error: "bad_type" }, { status: 400 });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ success: false, error: "too_large" }, { status: 400 });
    }
  }
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_REPLY_TOTAL_BYTES) {
    return NextResponse.json({ success: false, error: "too_large" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { data: inquiry, error } = await supabase.from("inquiries").select("id").eq("id", params.id).single();
  if (error || !inquiry) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }

  const uploads: Array<{ path: string; token: string; fileName: string }> = [];
  for (const file of files) {
    const type = file.type.toLowerCase() as Parameters<typeof safeFileName>[1];
    const path = messageAttachmentPath(params.id, safeFileName(file.name, type), randomUUID());
    const { data, error: signError } = await supabase.storage.from(ATTACHMENT_BUCKET).createSignedUploadUrl(path);
    if (signError || !data) {
      console.warn("[reply-uploads] 업로드 주소 발급 실패", { inquiryId: params.id }, signError);
      return NextResponse.json({ success: false, error: "sign_failed" }, { status: 500 });
    }
    uploads.push({ path: data.path, token: data.token, fileName: file.name.trim() || safeFileName(null, type) });
  }

  return NextResponse.json({ success: true, uploads });
}
