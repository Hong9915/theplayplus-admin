import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase";
import { getAdminSession } from "@/lib/require-admin-session";
import { recordEvent } from "@/lib/events";

const schema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  status: z.enum(["new", "in_progress", "resolved"]),
});

/** 목록에서 여러 건을 골라 한 번에 상태를 바꾼다. 건마다 변경 이력을 남긴다. */
export async function POST(request: Request) {
  const actor = await getAdminSession();
  if (!actor) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_request" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { ids, status } = parsed.data;

  const { data: before } = await supabase.from("inquiries").select("id, status").in("id", ids);
  const previous = new Map((before ?? []).map((row: { id: string; status: string }) => [row.id, row.status]));

  // 이미 그 상태인 건은 건드리지 않는다. 이력에 "완료 → 완료"가 남으면 소음이다.
  const targets = ids.filter((id) => previous.has(id) && previous.get(id) !== status);
  if (targets.length === 0) {
    return NextResponse.json({ success: true, updated: 0 });
  }

  const { error } = await supabase.from("inquiries").update({ status }).in("id", targets);
  if (error) {
    return NextResponse.json({ success: false, error: "update_failed" }, { status: 500 });
  }

  await Promise.all(
    targets.map((id) =>
      recordEvent(supabase, {
        inquiryId: id,
        actor,
        kind: "status_changed",
        fromValue: previous.get(id) ?? null,
        toValue: status,
      }).catch(() => {})
    )
  );

  return NextResponse.json({ success: true, updated: targets.length });
}
