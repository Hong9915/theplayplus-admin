import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { deleteTemplate, setTemplateAutoSend, updateTemplate } from "@/lib/templates";

// 삭제·수정에 필요한 것은 템플릿 id뿐이다. /api/games/[gameId]/templates/[id]로
// 중첩하면 gameId가 검증에도 쓰이지 않으면서 URL만 길어진다.

// PATCH는 두 가지 수정을 받는다: 자동 발송 토글({ autoSend })과 내용 수정
// ({ title, content, typeKey }). 한 요청에 하나만 온다.
const patchSchema = z.union([
  z.object({ autoSend: z.boolean() }),
  z.object({
    typeKey: z.string().trim().min(1).nullable(),
    title: z.string().trim().min(1).max(100),
    content: z.string().trim().min(1).max(5000),
  }),
]);

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_template" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const updated =
    "autoSend" in parsed.data
      ? // 켜면 같은 게임·유형의 다른 템플릿은 꺼진다.
        await setTemplateAutoSend(supabase, params.id, parsed.data.autoSend)
      : await updateTemplate(supabase, params.id, parsed.data);

  if (!updated) {
    return NextResponse.json({ success: false, error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  const deleted = await deleteTemplate(supabase, params.id);

  if (!deleted) {
    return NextResponse.json({ success: false, error: "delete_failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
