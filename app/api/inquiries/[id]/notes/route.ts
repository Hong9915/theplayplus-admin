import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase";
import { getAdminSession } from "@/lib/require-admin-session";
import { createNote } from "@/lib/notes";
import { recordEvent } from "@/lib/events";

const noteSchema = z.object({ content: z.string().trim().min(1).max(5000) });

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const actor = await getAdminSession();
  if (!actor) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = noteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_note" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();

  // 메모는 이벤트와 달리 실패를 삼키지 않는다. 방금 쓴 글이 조용히 사라지면 안 된다.
  const saved = await createNote(supabase, {
    inquiryId: params.id,
    author: actor,
    content: parsed.data.content,
  });

  if (!saved) {
    return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
  }

  await recordEvent(supabase, { inquiryId: params.id, actor, kind: "note_added" }).catch(() => {});

  return NextResponse.json({ success: true });
}
