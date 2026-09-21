import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { markLoungeItemRead } from "@/lib/lounge-items";

/** uuid가 아닌 id를 그대로 넘기면 Postgres가 던져 500이 된다. 먼저 걸러 400으로 알린다. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 라운지 항목을 눌러 네이버로 넘어갈 때 읽음으로 바꾼다. */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }
  if (!UUID.test(params.id)) {
    return NextResponse.json({ success: false, error: "invalid_id" }, { status: 400 });
  }
  const ok = await markLoungeItemRead(getSupabaseServerClient(), params.id);
  return ok ? NextResponse.json({ success: true }) : NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
}
