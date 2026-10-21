import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { gamePageOrderSchema, saveGamePageOrder } from "@/lib/game-pages";

/** 웹사이트 게임 목록 순서를 통째로 저장한다. 맨 앞 게임이 sort_order 0. */
export async function PUT(request: Request) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const parsed = gamePageOrderSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_input" }, { status: 400 });
  }

  if (!(await saveGamePageOrder(getSupabaseServerClient(), parsed.data.gameIds))) {
    return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
