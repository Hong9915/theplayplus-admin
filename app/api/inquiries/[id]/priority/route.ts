import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";

const prioritySchema = z.object({ priority: z.enum(["urgent", "high", "normal", "low"]) });

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = prioritySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_priority" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("inquiries").update({ priority: parsed.data.priority }).eq("id", params.id);

  if (error) {
    return NextResponse.json({ success: false, error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
