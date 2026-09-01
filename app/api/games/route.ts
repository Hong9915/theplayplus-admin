import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { gameFormSchema } from "@/lib/game-schema";
import { getSupabaseServerClient } from "@/lib/supabase";
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
    .select("id")
    .single();

  if (insertError || !inserted) {
    return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
  }

  let logoWarning: string | undefined;
  const logo = formData.get("logo");
  if (logo instanceof File && logo.size > 0) {
    const path = `${inserted.id}/${randomUUID()}-${logo.name}`;
    const { error: uploadError } = await supabase.storage.from("game-logos").upload(path, logo);
    if (uploadError) {
      logoWarning = logo.name;
    } else {
      await supabase.from("games").update({ logo_path: path }).eq("id", inserted.id);
    }
  }

  try {
    await createDefaultCategoriesForGame(supabase, inserted.id);
  } catch {
    await supabase.from("games").delete().eq("id", inserted.id);
    return NextResponse.json({ success: false, error: "category_seed_failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true, id: inserted.id, ...(logoWarning ? { logoWarning } : {}) }, { status: 200 });
}
