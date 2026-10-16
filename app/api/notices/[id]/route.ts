import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { deleteNotice, noticeSchema, updateNotice } from "@/lib/game-pages";

// 템플릿과 같은 이유로 공지 id만으로 다룬다(/api/templates/[id] 참고).

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const parsed = noticeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_notice" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  if (!(await updateNotice(supabase, params.id, parsed.data))) {
    return NextResponse.json({ success: false, error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  if (!(await deleteNotice(supabase, params.id))) {
    return NextResponse.json({ success: false, error: "delete_failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
