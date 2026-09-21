import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { connectLounge } from "@/lib/lounge-connect";

const bodySchema = z.object({ loungeUrl: z.string().max(500) });

/** 게임에 네이버 라운지를 연결·변경·해제한다. loungeUrl이 빈 문자열이면 해제. */
export async function PATCH(request: Request, { params }: { params: { gameId: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_input" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { data: game } = await supabase.from("games").select("id").eq("id", params.gameId).maybeSingle();
  if (!game) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }

  const result = await connectLounge(supabase, params.gameId, parsed.data.loungeUrl);
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.error === "save_failed" ? 500 : 400 });
  }
  return NextResponse.json({ success: true, loungeId: result.loungeId });
}
