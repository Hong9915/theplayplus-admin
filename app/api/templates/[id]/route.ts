import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { deleteTemplate } from "@/lib/templates";

// 삭제에 필요한 것은 템플릿 id뿐이다. /api/games/[gameId]/templates/[id]로
// 중첩하면 gameId가 검증에도 쓰이지 않으면서 URL만 길어진다.
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  const deleted = await deleteTemplate(supabase, params.id);

  if (!deleted) {
    return NextResponse.json({ success: false, error: "delete_failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
