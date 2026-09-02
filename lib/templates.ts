import type { SupabaseClient } from "@supabase/supabase-js";

export interface TemplateRow {
  id: string;
  typeKey: string | null;
  title: string;
  content: string;
}

export interface CreateTemplateInput {
  gameId: string;
  typeKey: string | null;
  title: string;
  content: string;
}

export async function listTemplates(supabase: SupabaseClient, gameId: string): Promise<TemplateRow[]> {
  const { data, error } = await supabase
    .from("reply_templates")
    .select("id, type_key, title, content")
    .eq("game_id", gameId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error || !data) {
    return [];
  }

  return data.map((row) => ({
    id: row.id,
    typeKey: row.type_key,
    title: row.title,
    content: row.content,
  }));
}

/** 메모와 같이 성공 여부를 돌려준다. 방금 만든 템플릿이 조용히 사라지면 안 된다. */
export async function createTemplate(supabase: SupabaseClient, input: CreateTemplateInput): Promise<boolean> {
  const { error } = await supabase.from("reply_templates").insert({
    game_id: input.gameId,
    type_key: input.typeKey,
    title: input.title,
    content: input.content,
  });
  return !error;
}

export async function deleteTemplate(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { error } = await supabase.from("reply_templates").delete().eq("id", id);
  return !error;
}
