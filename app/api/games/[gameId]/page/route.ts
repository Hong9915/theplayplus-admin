import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { gamePageSchema, saveGamePage } from "@/lib/game-pages";

/** 웹사이트 게임 페이지의 글·링크·공개 여부를 통째로 저장한다. 이미지는 images 라우트가 따로 다룬다. */
export async function PUT(request: Request, { params }: { params: { gameId: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = gamePageSchema.safeParse(body);
  if (!parsed.success) {
    // 어느 칸이 틀렸는지 화면이 그 칸에 표시할 수 있게 넘긴다.
    const fields = Array.from(new Set(parsed.error.issues.map((issue) => String(issue.path[0]))));
    return NextResponse.json({ success: false, error: "invalid_input", fields }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const result = await saveGamePage(supabase, params.gameId, parsed.data);
  if (!result.ok) {
    const status = result.error === "slug_taken" ? 409 : 500;
    return NextResponse.json({ success: false, error: result.error }, { status });
  }

  return NextResponse.json({ success: true, page: result.page });
}
