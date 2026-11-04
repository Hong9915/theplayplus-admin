import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { gameSubtitleSchema } from "@/lib/game-schema";

/** 게임 설정 서랍의 "부제" 저장. 고객센터 게임 선택 타일에서 이름 아래에 나온다. */
export async function PATCH(request: Request, { params }: { params: { gameId: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = gameSubtitleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_input" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("games")
    .update({ subtitle: parsed.data.subtitle })
    .eq("id", params.gameId)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, subtitle: parsed.data.subtitle });
}

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
