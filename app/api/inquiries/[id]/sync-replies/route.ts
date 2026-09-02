import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { fetchInboundReplies } from "@/lib/gmail";
import { createInboundMessage, listGmailMessageIds } from "@/lib/messages";

/**
 * Gmail 스레드에서 사용자 회신을 가져와 inquiry_messages에 넣는다.
 * 이미 들어온 메일(gmail_message_id 기준)은 건너뛴다.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  const { data: inquiry, error } = await supabase
    .from("inquiries")
    .select("id, gmail_thread_id")
    .eq("id", params.id)
    .single();

  if (error || !inquiry) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }
  if (!inquiry.gmail_thread_id) {
    return NextResponse.json({ success: false, error: "no_thread" }, { status: 400 });
  }

  let inbound;
  try {
    inbound = await fetchInboundReplies(inquiry.gmail_thread_id);
  } catch (fetchError) {
    console.warn("[sync-replies] Gmail thread fetch failed", fetchError);
    return NextResponse.json({ success: false, error: "fetch_failed" }, { status: 502 });
  }

  const known = await listGmailMessageIds(supabase, params.id);
  let added = 0;
  for (const email of inbound) {
    if (known.has(email.gmailMessageId)) continue;
    // 본문이 비면(첨부만 있거나 인용문뿐) 표시할 게 없으니 건너뛴다.
    if (!email.body.trim()) continue;
    const inserted = await createInboundMessage(supabase, {
      inquiryId: params.id,
      fromEmail: email.fromEmail,
      body: email.body,
      gmailMessageId: email.gmailMessageId,
      rfcMessageId: email.rfcMessageId,
      sentAt: email.sentAt,
    });
    if (inserted) added += 1;
  }

  return NextResponse.json({ success: true, added });
}
