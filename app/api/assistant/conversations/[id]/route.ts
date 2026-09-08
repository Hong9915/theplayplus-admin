import { NextResponse } from "next/server";
import { assistantChatEnabled, ASSISTANT_CHAT_DISABLED } from "@/lib/assistant-flags";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { deleteConversation } from "@/lib/assistant-store";

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  if (!assistantChatEnabled()) {
    return NextResponse.json(ASSISTANT_CHAT_DISABLED, { status: 404 });
  }
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }
  const ok = await deleteConversation(getSupabaseServerClient(), params.id);
  if (!ok) {
    return NextResponse.json({ success: false, error: "delete_failed" }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
