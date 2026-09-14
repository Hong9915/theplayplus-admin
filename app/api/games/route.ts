import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { gameFormSchema } from "@/lib/game-schema";
import { getSupabaseServerClient } from "@/lib/supabase";
import { buildGameLogoPath } from "@/lib/storage";
import { createDefaultCategoriesForGame } from "@/lib/categories";
import { createDefaultTemplatesForGame } from "@/lib/default-templates";
import { getAdminSession } from "@/lib/require-admin-session";
import { createOpsDoc, opsDocEditors, isOpsDocConfigured } from "@/lib/ops-doc";
import { insertSource } from "@/lib/assistant-sources";

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();

  const parsed = gameFormSchema.safeParse({
    name: formData.get("name"),
    status: formData.get("status") || undefined,
    ownerName: formData.get("ownerName") ?? "",
  });

  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_input" }, { status: 400 });
  }

  const input = parsed.data;
  const supabase = getSupabaseServerClient();

  const { data: inserted, error: insertError } = await supabase
    .from("games")
    .insert({
      name: input.name,
      status: input.status,
      owner_name: input.ownerName || null,
    })
    .select("id, created_at")
    .single();

  if (insertError || !inserted) {
    return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
  }

  let logoPath: string | null = null;
  let warning: string | undefined;
  const logo = formData.get("logo");
  if (logo instanceof File && logo.size > 0) {
    // The raw filename can never go into the key: Supabase Storage rejects
    // non-ASCII keys, which is exactly what a Korean logo filename produces.
    const path = buildGameLogoPath(inserted.id, logo.name, randomUUID());
    const { error: uploadError } = await supabase.storage
      .from("game-logos")
      .upload(path, logo, { contentType: logo.type || undefined });

    if (uploadError) {
      // The logo is a best-effort extra; never roll back the game for it.
      console.error("[api/games] logo upload failed", { path, message: uploadError.message });
      warning = "logo_upload_failed";
    } else {
      const { error: logoUpdateError } = await supabase
        .from("games")
        .update({ logo_path: path })
        .eq("id", inserted.id);

      if (logoUpdateError) {
        console.error("[api/games] logo path update failed", { path, message: logoUpdateError.message });
        warning = "logo_upload_failed";
      } else {
        logoPath = path;
      }
    }
  }

  try {
    await createDefaultCategoriesForGame(supabase, inserted.id);
  } catch {
    await supabase.from("games").delete().eq("id", inserted.id);
    return NextResponse.json({ success: false, error: "category_seed_failed" }, { status: 500 });
  }

  // 자동 답변 템플릿은 화면에서 다시 만들 수 있는 부가 데이터다. 실패해도
  // 게임을 되돌리지 않고 경고만 낸다. 로고 경고가 이미 있으면 그쪽을 남긴다.
  try {
    await createDefaultTemplatesForGame(supabase, inserted.id);
  } catch (error) {
    console.error("[api/games] default template seed failed", { gameId: inserted.id, error });
    warning = warning ?? "template_seed_failed";
  }

  // 운영 현황 구글 문서를 만들어 만든 관리자에게 공유하고 문서 자료로 연결한다.
  // 토큰이 없거나 실패하면 게임은 그대로 두고 경고만 낸다 — 문서는 운영 자료
  // 화면에서 직접 만들어 붙일 수 있다.
  if (!isOpsDocConfigured()) {
    warning = warning ?? "ops_doc_not_configured";
  } else {
    try {
      const doc = await createOpsDoc({ gameName: input.name, editors: opsDocEditors(session.email) });
      const source = await insertSource(supabase, { gameId: inserted.id, kind: "doc", externalId: doc.docId, title: doc.title });
      if (source === null) throw new Error("insertSource failed");
    } catch (error) {
      console.error("[api/games] ops doc setup failed", { gameId: inserted.id, error });
      warning = warning ?? "ops_doc_failed";
    }
  }

  return NextResponse.json(
    {
      success: true,
      game: {
        id: inserted.id,
        name: input.name,
        status: input.status,
        logoPath,
        ownerName: input.ownerName || null,
        createdAt: inserted.created_at,
      },
      ...(warning ? { warning } : {}),
    },
    { status: 200 }
  );
}
