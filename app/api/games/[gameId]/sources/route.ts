import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { insertSource, parseSourceUrl } from "@/lib/assistant-sources";
import { readSpreadsheetTitle, SheetError } from "@/lib/sheets";
import { readDocument } from "@/lib/docs";

/**
 * 자료(구글 시트·문서) 등록. 등록 시점에 제목을 읽어 저장하므로, 공유가 안 돼 있으면
 * 여기서 바로 거절되어 관리자가 원인을 안다. 읽기 실패는 200으로 사유를 돌려준다.
 */
export async function POST(request: Request, { params }: { params: { gameId: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "invalid_input" }, { status: 400 });
  }
  const url = typeof parsed === "object" && parsed !== null && typeof (parsed as { url?: unknown }).url === "string" ? (parsed as { url: string }).url : "";
  const target = parseSourceUrl(url);
  if (!target) {
    return NextResponse.json({ success: false, error: "invalid_input" }, { status: 400 });
  }

  let title: string;
  try {
    title = target.kind === "sheet" ? await readSpreadsheetTitle(target.externalId) : (await readDocument(target.externalId)).title;
  } catch (error) {
    const reason = error instanceof SheetError ? error.reason : "source_read_failed";
    return NextResponse.json({ success: false, error: reason });
  }

  const source = await insertSource(getSupabaseServerClient(), { gameId: params.gameId, kind: target.kind, externalId: target.externalId, title });
  if (source === "duplicate") {
    return NextResponse.json({ success: false, error: "duplicate" }, { status: 409 });
  }
  if (!source) {
    return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
  }
  return NextResponse.json({ success: true, source });
}
