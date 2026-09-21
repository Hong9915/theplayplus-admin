import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { markAllLoungeItemsRead } from "@/lib/lounge-items";

/** 문의함의 "모두 읽음"과 같은 동작을 라운지 목록에서도 쓴다. */
export async function POST(_request: Request, { params }: { params: { gameId: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }
  const ok = await markAllLoungeItemsRead(getSupabaseServerClient(), params.gameId);
  return ok ? NextResponse.json({ success: true }) : NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
}
