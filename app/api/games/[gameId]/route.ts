import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { parseSheetUrl, serviceAccountEmail } from "@/lib/sheets";

export async function DELETE(_request: Request, { params }: { params: { gameId: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();

  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("id, logo_path")
    .eq("id", params.gameId)
    .single();

  if (gameError || !game) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }

  // Best-effort storage cleanup; orphaned files must never block the delete.
  const { data: inquiries } = await supabase.from("inquiries").select("id").eq("game_id", params.gameId);
  const inquiryIds = (inquiries ?? []).map((inquiry) => inquiry.id);
  if (inquiryIds.length > 0) {
    const { data: attachments } = await supabase
      .from("inquiry_attachments")
      .select("file_path")
      .in("inquiry_id", inquiryIds);
    const filePaths = (attachments ?? []).map((attachment) => attachment.file_path);
    if (filePaths.length > 0) {
      await supabase.storage.from("inquiry-attachments").remove(filePaths);
    }
  }

  // inquiries.game_id has no ON DELETE rule, so inquiries go first
  // (attachment rows cascade), then the game (groups/types cascade).
  const { error: inquiriesError } = await supabase.from("inquiries").delete().eq("game_id", params.gameId);
  if (inquiriesError) {
    return NextResponse.json({ success: false, error: "delete_failed" }, { status: 500 });
  }

  const { error: deleteError } = await supabase.from("games").delete().eq("id", params.gameId);
  if (deleteError) {
    return NextResponse.json({ success: false, error: "delete_failed" }, { status: 500 });
  }

  if (game.logo_path) {
    await supabase.storage.from("game-logos").remove([game.logo_path]);
  }

  return NextResponse.json({ success: true });
}

/** 운영 시트 연결. URL이나 ID를 받아 games.sheet_id에 저장한다. */
export async function PATCH(request: Request, { params }: { params: { gameId: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { sheetUrl?: unknown };
  try {
    body = (await request.json()) as { sheetUrl?: unknown };
  } catch {
    return NextResponse.json({ success: false, error: "invalid_input" }, { status: 400 });
  }

  const sheetId = typeof body.sheetUrl === "string" ? parseSheetUrl(body.sheetUrl) : null;
  if (!sheetId) {
    return NextResponse.json({ success: false, error: "invalid_input" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("games").update({ sheet_id: sheetId }).eq("id", params.gameId).select("id").single();

  if (error?.code === "PGRST116" || (!error && !data)) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }
  if (error) {
    return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true, sheetId, serviceAccountEmail: serviceAccountEmail() });
}
