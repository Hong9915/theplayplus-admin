import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { markLoungeItemRead } from "@/lib/lounge-items";

/** 라운지 항목을 눌러 네이버로 넘어갈 때 읽음으로 바꾼다. */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }
  const ok = await markLoungeItemRead(getSupabaseServerClient(), params.id);
  return ok ? NextResponse.json({ success: true }) : NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
}
