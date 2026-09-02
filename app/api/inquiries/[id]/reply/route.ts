import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase";
import { sendReplyEmail } from "@/lib/gmail";
import { getAdminSession } from "@/lib/require-admin-session";
import { recordEvent } from "@/lib/events";

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
    .select("id, reply_email, title, inquiry_no")
    .eq("id", params.id)
    .single();

  if (fetchError || !inquiry) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }

  // 접수번호를 제목에 넣어 사용자가 메일로 다시 문의해도 건을 특정할 수 있게 한다.
  const subject = inquiry.inquiry_no ? `[${inquiry.inquiry_no}] Re: ${inquiry.title}` : `Re: ${inquiry.title}`;

  try {
    await sendReplyEmail({
      to: inquiry.reply_email,
      subject,
      body: parsed.data.replyContent,
    });
  } catch {
    return NextResponse.json({ success: false, error: "send_failed" }, { status: 500 });
  }

  const { error: updateError } = await supabase
    .from("inquiries")
    .update({
      // 답변을 보냈다고 끝난 건 아니다. 사용자 회신이나 후속 확인이 남을 수
      // 있으니 처리중으로 두고, 완료는 관리자가 직접 바꾼다.
      status: "in_progress",
      reply_content: parsed.data.replyContent,
      replied_at: new Date().toISOString(),
      // 발송했으니 초안은 비운다.
      draft_reply: null,
    })
    .eq("id", params.id);

  if (updateError) {
    return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
  }

  // 이력 적재는 부가 작업이다. 실패해도 이미 나간 메일을 되돌릴 수 없다.
  await recordEvent(supabase, { inquiryId: params.id, actor, kind: "reply_sent" }).catch(() => {});

  return NextResponse.json({ success: true });
}
