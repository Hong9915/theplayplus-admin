import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";

/** 문의 한 건을 지운다. 첨부·메모·이력·대화 행은 외래키 cascade로 같이 지워진다. */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();

  const { data: inquiry, error: inquiryError } = await supabase
    .from("inquiries")
    .select("id")
    .eq("id", params.id)
    .single();

  if (inquiryError || !inquiry) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }

  // 첨부 행은 cascade로 사라지므로 파일 경로를 먼저 읽어 둔다.
  const { data: attachments } = await supabase
    .from("inquiry_attachments")
    .select("file_path")
    .eq("inquiry_id", params.id);
  const filePaths = (attachments ?? []).map((attachment) => attachment.file_path);

  const { error: deleteError } = await supabase.from("inquiries").delete().eq("id", params.id);
  if (deleteError) {
    return NextResponse.json({ success: false, error: "delete_failed" }, { status: 500 });
  }

  // 파일 정리는 행을 지운 뒤에 한다. 실패해 남는 파일이 있어도 삭제를 되돌리지 않는다.
  if (filePaths.length > 0) {
    await supabase.storage.from("inquiry-attachments").remove(filePaths).catch(() => {});
  }

  return NextResponse.json({ success: true });
}
