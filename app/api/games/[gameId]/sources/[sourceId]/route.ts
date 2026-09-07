import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { deleteSource } from "@/lib/assistant-sources";

export async function DELETE(_request: Request, { params }: { params: { gameId: string; sourceId: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }
  const ok = await deleteSource(getSupabaseServerClient(), params.gameId, params.sourceId);
  if (!ok) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
