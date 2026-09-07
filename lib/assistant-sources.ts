/**
 * 운영 어시스턴트가 근거로 쓰는 자료(구글 시트·문서). 게임마다 여러 개.
 * 저장소·읽기·직렬화. 타입과 URL 규칙은 lib/source-url.ts(클라이언트에서도 씀)에 있고 여기서 재수출한다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_SHEET_CHARS, readSpreadsheet, serializeSheets, SheetError, type SheetTab } from "@/lib/sheets";
import { readDocument } from "@/lib/docs";
import { parseSourceUrl, sourceUrl, type SourceKind, type SourceRow } from "@/lib/source-url";

export { parseSourceUrl, sourceUrl, type SourceKind, type SourceRow };

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

export type LoadedSource =
  | { source: SourceRow; kind: "sheet"; tabs: SheetTab[] }
  | { source: SourceRow; kind: "doc"; text: string };

async function loadOne(source: SourceRow): Promise<LoadedSource> {
  try {
    if (source.kind === "sheet") {
      return { source, kind: "sheet", tabs: await readSpreadsheet(source.externalId) };
    }
    const { text } = await readDocument(source.externalId);
    return { source, kind: "doc", text };
  } catch (error) {
    if (error instanceof SheetError) {
      error.sourceTitle = source.title;
      throw error;
    }
    const wrapped = new SheetError("source_read_failed");
    wrapped.sourceTitle = source.title;
    throw wrapped;
  }
}

function sectionBody(loaded: LoadedSource): string {
  return loaded.kind === "sheet" ? serializeSheets(loaded.tabs) : loaded.text;
}

/** 자료를 병렬로 읽는다. 하나라도 실패하면 그 자료 제목을 단 SheetError. 합계가 상한을 넘어도 실패. */
export async function loadSources(sources: SourceRow[]): Promise<LoadedSource[]> {
  const loaded = await Promise.all(sources.map(loadOne));
  const total = loaded.reduce((sum, entry) => sum + sectionBody(entry).length, 0);
  if (total > MAX_SHEET_CHARS) throw new SheetError("sources_too_large");
  return loaded;
}

/** 모델에 싣는 본문. `# 시트: 제목` / `# 문서: 제목` 구간, 구간 사이 빈 줄 둘. */
export function serializeSources(loaded: LoadedSource[]): string {
  return loaded
    .map((entry) => {
      const label = entry.kind === "sheet" ? "시트" : "문서";
      return `# ${label}: ${entry.source.title}\n\n${sectionBody(entry)}`;
    })
    .join("\n\n\n");
}
