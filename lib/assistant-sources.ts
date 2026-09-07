/**
 * 운영 어시스턴트가 근거로 쓰는 자료(구글 시트·문서). 게임마다 여러 개.
 * 이 파일은 저장소와 URL 규칙만 다룬다. 읽기·직렬화는 Task 4에서 이 파일에 덧붙인다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type SourceKind = "sheet" | "doc";

export interface SourceRow {
  id: string;
  gameId: string;
  kind: SourceKind;
  externalId: string;
  title: string;
  createdAt: string;
}

/** 종류는 URL 경로로만 판별한다. ID만 오면 시트인지 문서인지 알 수 없어 null. */
export function parseSourceUrl(input: string): { kind: SourceKind; externalId: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^https:\/\/docs\.google\.com\/(spreadsheets|document)\/d\/([A-Za-z0-9_-]+)/);
  if (!match) return null;
  return { kind: match[1] === "spreadsheets" ? "sheet" : "doc", externalId: match[2] };
}

export function sourceUrl(source: Pick<SourceRow, "kind" | "externalId">): string {
  const segment = source.kind === "sheet" ? "spreadsheets" : "document";
  return `https://docs.google.com/${segment}/d/${source.externalId}/edit`;
}

function mapSource(row: { id: string; game_id: string; kind: string; external_id: string; title: string; created_at: string }): SourceRow {
  return { id: row.id, gameId: row.game_id, kind: row.kind as SourceKind, externalId: row.external_id, title: row.title, createdAt: row.created_at };
}

export async function listSources(supabase: SupabaseClient, gameId: string): Promise<SourceRow[]> {
  const { data, error } = await supabase.from("assistant_sources").select("*").eq("game_id", gameId).order("created_at", { ascending: true });
  if (error) throw new Error(`Failed to list sources: ${error.message}`);
  return (data ?? []).map(mapSource);
}

export async function getSource(supabase: SupabaseClient, id: string): Promise<SourceRow | null> {
  const { data, error } = await supabase.from("assistant_sources").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return mapSource(data);
}

export async function insertSource(
  supabase: SupabaseClient,
  input: { gameId: string; kind: SourceKind; externalId: string; title: string }
): Promise<SourceRow | null | "duplicate"> {
  const { data, error } = await supabase
    .from("assistant_sources")
    .insert({ game_id: input.gameId, kind: input.kind, external_id: input.externalId, title: input.title })
    .select("*")
    .single();
  if (error?.code === "23505") return "duplicate";
  if (error || !data) return null;
  return mapSource(data);
}

/** 그 게임의 자료만 지운다. 지워진 행이 없으면 false. */
export async function deleteSource(supabase: SupabaseClient, gameId: string, id: string): Promise<boolean> {
  const { data, error } = await supabase.from("assistant_sources").delete().eq("id", id).eq("game_id", gameId).select("id");
  if (error) return false;
  return (data ?? []).length > 0;
}
