import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase";
import { getAdminSession } from "@/lib/require-admin-session";
import { recordEvent } from "@/lib/events";

const statusSchema = z.object({ status: z.enum(["new", "in_progress", "resolved"]) });

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const actor = await getAdminSession();
  if (!actor) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = statusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_status" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();

  // 이력에 "무엇에서 무엇으로"를 남기려면 변경 전 값이 필요하다.
  const { data: before } = await supabase.from("inquiries").select("status").eq("id", params.id).single();

  const { error } = await supabase.from("inquiries").update({ status: parsed.data.status }).eq("id", params.id);

  if (error) {
    return NextResponse.json({ success: false, error: "update_failed" }, { status: 500 });
  }

  // 이력 적재는 부가 작업이다. 실패해도 상태 변경을 되돌리지 않는다.
  await recordEvent(supabase, {
    inquiryId: params.id,
    actor,
    kind: "status_changed",
    fromValue: before?.status ?? null,
    toValue: parsed.data.status,
  }).catch(() => {});

  return NextResponse.json({ success: true });
}
