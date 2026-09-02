import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { getInquiryById } from "@/lib/inquiries";
import { listCategoryLabels, listGames } from "@/lib/categories";
import { listTemplates } from "@/lib/templates";
import { listRecentRepliesByType } from "@/lib/replies";
import { requestSuggestion } from "@/lib/suggest";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  const inquiry = await getInquiryById(supabase, params.id);
  if (!inquiry) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }

  const [labels, games, templates, pastReplies] = await Promise.all([
    listCategoryLabels(supabase, inquiry.gameId),
    listGames(supabase),
    listTemplates(supabase, inquiry.gameId),
    listRecentRepliesByType(supabase, inquiry.gameId, inquiry.typeKey),
  ]);

  const game = games.find((entry) => entry.id === inquiry.gameId);

  // 해당 유형 템플릿 + 공용 템플릿(type_key가 null)만 근거로 넘긴다.
  const relevant = templates.filter(
    (template) => template.typeKey === null || template.typeKey === inquiry.typeKey
  );

  const result = await requestSuggestion({
    gameName: game?.name ?? "",
    groupLabel: labels.groupLabels[inquiry.groupKey] ?? inquiry.groupKey,
    typeLabel: labels.typeLabels[inquiry.typeKey] ?? inquiry.typeKey,
    title: inquiry.title,
    content: inquiry.content,
    gameAccount: inquiry.gameAccount,
    companyName: inquiry.companyName,
    templates: relevant.map((template) => ({ title: template.title, content: template.content })),
    pastReplies,
  });

  if (!result.ok) {
    // not_configured / refused / failed를 구분해 내려야 화면이 관리자에게
    // 무엇을 고쳐야 할지 알려줄 수 있다.
    return NextResponse.json({ success: false, error: result.reason }, { status: 500 });
  }

  // 추천은 이력에 남기지 않는다 — 초안 생성일 뿐이고 여러 번 눌린다.
  return NextResponse.json({ success: true, suggestion: result.text });
}
