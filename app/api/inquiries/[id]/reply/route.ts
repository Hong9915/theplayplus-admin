import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase";
import { getAdminSession } from "@/lib/require-admin-session";
import { REPLYABLE_INQUIRY_COLUMNS, ReplySaveError, sendInquiryReply } from "@/lib/send-reply";

const replySchema = z.object({ replyContent: z.string().trim().min(1).max(5000) });

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const actor = await getAdminSession();
  if (!actor) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = replySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_reply" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { data: inquiry, error: fetchError } = await supabase
    .from("inquiries")
    .select(REPLYABLE_INQUIRY_COLUMNS)
    .eq("id", params.id)
    .single();

  if (fetchError || !inquiry) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }

  // 메일 조립·발송·기록은 자동 답변과 공용인 lib/send-reply에 있다.
  let recorded: boolean;
  try {
    ({ recorded } = await sendInquiryReply(supabase, {
      inquiry,
      body: parsed.data.replyContent,
      mode: "manual",
      actor,
    }));
  } catch (error) {
    if (error instanceof ReplySaveError) {
      console.error("[reply] inquiry update failed after sending", { inquiryId: params.id });
      return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
    }
    // 원인이 응답에는 안 실리니 서버 로그에 남긴다. Gmail 오류는 message에 사유가 있다.
    console.error("[reply] send failed", { inquiryId: params.id }, error);
    return NextResponse.json({ success: false, error: "send_failed" }, { status: 500 });
  }

  // 메일은 이미 나갔으므로 기록 실패로 발송을 되돌릴 수는 없다. 대신 경고를
  // 내려 관리자가 스레드에 빠진 답변이 있음을 알게 한다.
  return NextResponse.json({ success: true, ...(recorded ? {} : { warning: "message_save_failed" }) });
}
