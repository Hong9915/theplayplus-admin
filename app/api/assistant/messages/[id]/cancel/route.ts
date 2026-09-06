import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { getMessage, updateProposalStatus } from "@/lib/assistant-store";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  const message = await getMessage(supabase, params.id);
  if (!message || message.role !== "proposal") {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }
  if (message.status !== "pending") {
    return NextResponse.json({ success: false, error: "not_pending" }, { status: 409 });
  }

  const ok = await updateProposalStatus(supabase, message.id, { status: "cancelled" });
  if (!ok) {
    return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
  }
  return NextResponse.json({ success: true, status: "cancelled" });
}
