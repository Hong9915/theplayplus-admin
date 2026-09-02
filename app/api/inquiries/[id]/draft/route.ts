import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase";
import { getAdminSession } from "@/lib/require-admin-session";

const draftSchema = z.object({ draftReply: z.string().max(5000) });

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const actor = await getAdminSession();
  if (!actor) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = draftSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_draft" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  // 빈 문자열은 "초안 없음"으로 저장한다. 빈 문자열이 남으면 프리필이 애매해진다.
  const { error } = await supabase
    .from("inquiries")
    .update({ draft_reply: parsed.data.draftReply === "" ? null : parsed.data.draftReply })
    .eq("id", params.id);

  if (error) {
    return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
  }

  // 초안 저장은 자주 눌리는 동작이라 이력을 남기지 않는다 (스펙 결정 4).
  return NextResponse.json({ success: true });
}
