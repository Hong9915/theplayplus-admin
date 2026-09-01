import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase";
import { sendReplyEmail } from "@/lib/gmail";

const replySchema = z.object({ replyContent: z.string().trim().min(1).max(5000) });

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json();
  const parsed = replySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_reply" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { data: inquiry, error: fetchError } = await supabase
    .from("inquiries")
    .select("id, reply_email, title")
    .eq("id", params.id)
    .single();

  if (fetchError || !inquiry) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }

  try {
    await sendReplyEmail({
      to: inquiry.reply_email,
      subject: `Re: ${inquiry.title}`,
      body: parsed.data.replyContent,
    });
  } catch {
    return NextResponse.json({ success: false, error: "send_failed" }, { status: 500 });
  }

  const { error: updateError } = await supabase
    .from("inquiries")
    .update({
      status: "resolved",
      reply_content: parsed.data.replyContent,
      replied_at: new Date().toISOString(),
    })
    .eq("id", params.id);

  if (updateError) {
    return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
