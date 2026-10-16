import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { createNotice, noticeSchema } from "@/lib/game-pages";

export async function POST(request: Request, { params }: { params: { gameId: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const parsed = noticeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_notice" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  if (!(await createNotice(supabase, params.gameId, parsed.data))) {
    return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
