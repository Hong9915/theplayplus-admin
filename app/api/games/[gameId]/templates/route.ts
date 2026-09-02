import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { createTemplate } from "@/lib/templates";

const templateSchema = z.object({
  typeKey: z.string().trim().min(1).nullable(),
  title: z.string().trim().min(1).max(100),
  content: z.string().trim().min(1).max(5000),
});

export async function POST(request: Request, { params }: { params: { gameId: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = templateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_template" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const saved = await createTemplate(supabase, {
    gameId: params.gameId,
    typeKey: parsed.data.typeKey,
    title: parsed.data.title,
    content: parsed.data.content,
  });

  if (!saved) {
    return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
