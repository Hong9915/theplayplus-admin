import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { getAdminSession } from "@/lib/require-admin-session";
import { conversationTitle, createConversation } from "@/lib/assistant-store";

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { gameId?: unknown; firstMessage?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ success: false, error: "invalid_input" }, { status: 400 });
  }
  if (typeof body.gameId !== "string" || !body.gameId) {
    return NextResponse.json({ success: false, error: "invalid_input" }, { status: 400 });
  }

  const title = conversationTitle(typeof body.firstMessage === "string" ? body.firstMessage : "");
  const conversation = await createConversation(getSupabaseServerClient(), { gameId: body.gameId, title, createdBy: session.email });
  if (!conversation) {
    return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
  }
  return NextResponse.json({ success: true, conversationId: conversation.id });
}
