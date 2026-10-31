import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase";
import { getAdminSession } from "@/lib/require-admin-session";
import { REPLYABLE_INQUIRY_COLUMNS, ReplySaveError, sendInquiryReply } from "@/lib/send-reply";
import { ReplyAttachmentError } from "@/lib/message-attachments";
import { MAX_REPLY_IMAGES } from "@/lib/attachment-rules";

// 사진만 보내는 답변도 있어 본문은 비어도 되지만, 둘 다 비면 보낼 게 없다.
const replySchema = z
  .object({
    replyContent: z.string().trim().max(5000),
    attachments: z
      .array(z.object({ path: z.string().min(1).max(500), fileName: z.string().min(1).max(200) }))
      .max(MAX_REPLY_IMAGES)
      .default([]),
  })
  .refine((value) => value.replyContent !== "" || value.attachments.length > 0);

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
  let attachmentsRecorded: boolean;
  try {
    ({ recorded, attachmentsRecorded } = await sendInquiryReply(supabase, {
      inquiry,
      body: parsed.data.replyContent,
      mode: "manual",
      actor,
      attachments: parsed.data.attachments,
    }));
  } catch (error) {
    if (error instanceof ReplyAttachmentError) {
      // 메일은 나가지 않았다. 사진을 다시 올리고 보내면 된다.
      console.warn("[reply] attachment load failed", { inquiryId: params.id }, error.message);
      return NextResponse.json({ success: false, error: "attachment_failed" }, { status: 400 });
    }
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
  const warning = !recorded ? "message_save_failed" : !attachmentsRecorded ? "attachment_save_failed" : null;
  return NextResponse.json({ success: true, ...(warning ? { warning } : {}) });
}
