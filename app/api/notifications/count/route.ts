import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { countAdminNotifications } from "@/lib/notification-count";

export const dynamic = "force-dynamic";

/**
 * 탭 제목 "(N)"용 알림 건수. 탭이 가려져 있을 때 RealtimeRefresh는 화면 전체를
 * 다시 그리지 않고 이 숫자만 새로 받아 제목을 바꾼다.
 */
export async function GET() {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }
  const count = await countAdminNotifications(getSupabaseServerClient());
  return NextResponse.json({ success: true, count });
}
