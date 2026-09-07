import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";

/**
 * 관리자가 문의를 열었을 때 "읽지 않은 회신" 표시를 지운다. 이미 비어 있어도
 * 그냥 성공. 대화 열의 MarkReadOnOpen이 마운트 시 한 번 부른다.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("inquiries").update({ unread_reply_at: null }).eq("id", params.id);
  if (error) {
    return NextResponse.json({ success: false, error: "update_failed" }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
