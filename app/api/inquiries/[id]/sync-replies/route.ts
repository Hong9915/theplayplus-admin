import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { fetchInboundReplies, fetchUnthreadedReplies, type InboundEmail } from "@/lib/gmail";
import { createInboundMessage, listMessages } from "@/lib/messages";
import { scopeForGameId } from "@/lib/inbox-scope";

/**
 * Gmail 스레드에서 사용자 회신을 가져와 inquiry_messages에 넣는다.
 * 사용자가 제목을 바꿔 답장해 Gmail이 다른 스레드로 만든 회신은 회신 주소로
 * 검색해 우리 Message-ID를 참조하는 것만 더한다.
 * 이미 들어온 메일(gmail_message_id 기준)은 건너뛴다.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  const { data: inquiry, error } = await supabase
    .from("inquiries")
    .select("id, game_id, gmail_thread_id, reply_email")
    .eq("id", params.id)
    .single();

  if (error || !inquiry) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }
  if (!inquiry.gmail_thread_id) {
    return NextResponse.json({ success: false, error: "no_thread" }, { status: 400 });
  }

  const stored = await listMessages(supabase, params.id);
  const known = new Set(stored.map((message) => message.gmailMessageId).filter((id): id is string => !!id));
  const outbound = stored.filter((message) => message.direction === "outbound");
  const rfcMessageIds = outbound.map((message) => message.rfcMessageId).filter((id): id is string => !!id);
  const firstSentAt = outbound.length > 0 ? new Date(outbound[0].sentAt) : null;

  // 게임 문의와 서비스 문의는 다른 계정으로 보냈으니 그 계정의 메일함에서 읽는다.
  const mailbox = scopeForGameId(inquiry.game_id).kind;
  let inbound: InboundEmail[];
  try {
    const [threaded, unthreaded] = await Promise.all([
      fetchInboundReplies(inquiry.gmail_thread_id, mailbox),
      firstSentAt && inquiry.reply_email
        ? fetchUnthreadedReplies(mailbox, { fromEmail: inquiry.reply_email, since: firstSentAt, rfcMessageIds })
        : Promise.resolve([]),
    ]);
    inbound = [...threaded, ...unthreaded];
  } catch (fetchError) {
    console.warn("[sync-replies] Gmail thread fetch failed", fetchError);
    return NextResponse.json({ success: false, error: "fetch_failed" }, { status: 502 });
  }

  let added = 0;
  for (const email of inbound) {
    if (known.has(email.gmailMessageId)) continue;
    known.add(email.gmailMessageId);
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
