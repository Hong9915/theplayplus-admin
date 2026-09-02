import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { gameFormSchema } from "@/lib/game-schema";
import { getSupabaseServerClient } from "@/lib/supabase";
import { buildGameLogoPath } from "@/lib/storage";
import { createDefaultCategoriesForGame } from "@/lib/categories";
import { requireAdminSession } from "@/lib/require-admin-session";

export async function POST(request: Request) {
  if (!(await requireAdminSession())) {
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
