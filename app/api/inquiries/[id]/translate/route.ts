import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { getInquiryById } from "@/lib/inquiries";
import { getMessage } from "@/lib/messages";
import { isSameLanguage, translateText, type TranslateErrorReason } from "@/lib/deepl";
import { saveTranslation, type TranslationTarget } from "@/lib/translations";

const bodySchema = z.discriminatedUnion("target", [
  z.object({ target: z.literal("inquiry"), lang: z.enum(["ko", "zh"]) }),
  z.object({ target: z.literal("message"), messageId: z.string().min(1), lang: z.enum(["ko", "zh"]) }),
]);

const ERROR_STATUS: Record<TranslateErrorReason, number> = {
  not_configured: 503,
  auth_failed: 502,
  quota_exceeded: 429,
  failed: 502,
};

/**
 * 대화 열 말풍선 하나를 DeepL로 번역해 저장한다. 원문은 클라이언트가 보낸 게
 * 아니라 DB에서 읽는다 — 번역 캐시가 실제 본문과 어긋나면 안 된다.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_request" }, { status: 400 });
  }
  const input = parsed.data;

  const supabase = getSupabaseServerClient();
  const inquiry = await getInquiryById(supabase, params.id);
  if (!inquiry) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }

  let source: string;
  let target: TranslationTarget;
  if (input.target === "inquiry") {
    source = inquiry.content;
    target = { kind: "inquiry", id: inquiry.id };
  } else {
    const message = await getMessage(supabase, inquiry.id, input.messageId);
    if (!message) {
      return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
    }
    source = message.body;
    target = { kind: "message", id: message.id };
  }

  const result = await translateText(source, input.lang);
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.reason }, { status: ERROR_STATUS[result.reason] });
  }
  // 원문이 이미 그 언어면 저장하지 않는다. 같은 글이 두 번 보이는 건 도움이 안 된다.
  if (isSameLanguage(result.sourceLang, input.lang)) {
    return NextResponse.json({ success: false, error: "same_language" });
  }

  // 저장 실패는 번역 자체를 막지 않는다 — 이번에는 보여주고, 다음에 다시 부르면 된다.
  const saved = await saveTranslation(supabase, target, input.lang, result.text);
  return NextResponse.json({ success: true, text: result.text, saved });
}
