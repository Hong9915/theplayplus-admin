/**
 * 운영 어시스턴트 자료(구글 시트·문서)의 타입과 URL 규칙.
 *
 * 클라이언트 컴포넌트(사이드바)도 값으로 import하므로 서버 전용 의존성(googleapis,
 * supabase)을 두지 않는다. 저장소·읽기·직렬화는 lib/assistant-sources.ts에 있다.
 */

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
