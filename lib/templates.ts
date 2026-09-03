import type { SupabaseClient } from "@supabase/supabase-js";

export interface TemplateRow {
  id: string;
  typeKey: string | null;
  title: string;
  content: string;
  /** 켜져 있으면 이 유형의 새 문의에 자동으로 발송된다 (마이그레이션 0010). */
  autoSend: boolean;
}

export interface CreateTemplateInput {
  gameId: string;
  typeKey: string | null;
  title: string;
  content: string;
}

const COLUMNS = "id, type_key, title, content, auto_send";

function mapRow(row: {
  id: string;
  type_key: string | null;
  title: string;
  content: string;
  auto_send?: boolean | null;
}): TemplateRow {
  return {
    id: row.id,
    typeKey: row.type_key,
    title: row.title,
    content: row.content,
    autoSend: row.auto_send === true,
  };
}

export async function listTemplates(supabase: SupabaseClient, gameId: string): Promise<TemplateRow[]> {
  const { data, error } = await supabase
    .from("reply_templates")
    .select(COLUMNS)
    .eq("game_id", gameId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error || !data) {
    return [];
  }

  return data.map(mapRow);
}

/**
 * 새 문의에 자동으로 보낼 템플릿. 유형 전용이 있으면 그것, 없으면 공용(type_key
 * null). 게임당 켜진 템플릿은 몇 개 안 되므로 전부 읽어 앱에서 고른다 —
 * PostgREST의 or 필터에 유형 키를 문자열로 끼워 넣는 것보다 단순하고 안전하다.
 */
export async function findAutoReplyTemplate(
  supabase: SupabaseClient,
  gameId: string,
  typeKey: string
): Promise<TemplateRow | null> {
  const { data, error } = await supabase
    .from("reply_templates")
    .select(COLUMNS)
    .eq("game_id", gameId)
    .eq("auto_send", true);

  if (error || !data) {
    return null;
  }

  const templates = data.map(mapRow);
  return (
    templates.find((template) => template.typeKey === typeKey) ??
    templates.find((template) => template.typeKey === null) ??
    null
  );
}

/**
 * 자동 발송 켜기/끄기. 켤 때는 같은 게임·유형의 다른 템플릿을 먼저 끈다.
 * DB 유니크 인덱스에 걸려 실패하는 것보다 "이걸로 바꾼다"가 관리자가
 * 기대하는 동작이다.
 */
export async function setTemplateAutoSend(supabase: SupabaseClient, id: string, autoSend: boolean): Promise<boolean> {
  const { data: template, error: lookupError } = await supabase
    .from("reply_templates")
    .select("game_id, type_key")
    .eq("id", id)
    .single();

  if (lookupError || !template) {
    return false;
  }

  if (autoSend) {
    let siblings = supabase.from("reply_templates").update({ auto_send: false }).eq("game_id", template.game_id);
    siblings = template.type_key === null ? siblings.is("type_key", null) : siblings.eq("type_key", template.type_key);
    const { error: clearError } = await siblings;
    if (clearError) {
      return false;
    }
  }

  const { error } = await supabase.from("reply_templates").update({ auto_send: autoSend }).eq("id", id);
  return !error;
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
