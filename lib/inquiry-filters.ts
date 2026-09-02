import type { InquiryStatus } from "@/lib/inquiries";

export type InquirySort = "newest" | "oldest" | "priority";

/**
 * 문의 목록의 필터·정렬·페이지 상태. URL 쿼리가 원본이다 — 상세에 들어갔다
 * 뒤로 와도, 링크를 공유해도 같은 화면이 나와야 한다.
 */
export interface InquiryListQuery {
  group: string | null;
  type: string | null;
  status: InquiryStatus | null;
  q: string;
  sort: InquirySort;
  page: number;
}

export const PAGE_SIZE = 50;

export const SORT_OPTIONS: Array<{ value: InquirySort; label: string }> = [
  { value: "newest", label: "최신순" },
  { value: "oldest", label: "오래된순" },
  { value: "priority", label: "우선순위순" },
];

const STATUSES: InquiryStatus[] = ["new", "in_progress", "resolved"];
const SORTS: InquirySort[] = ["newest", "oldest", "priority"];

export const DEFAULT_QUERY: InquiryListQuery = {
  group: null,
  type: null,
  status: null,
  q: "",
  sort: "newest",
  page: 1,
};

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams | string;

function readParam(params: RawParams, key: string): string | null {
  if (typeof params === "string") {
    return new URLSearchParams(params).get(key);
  }
  if (params instanceof URLSearchParams) {
    return params.get(key);
  }
  const value = params[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** 잘못된 값은 조용히 기본값으로 떨어뜨린다. URL은 사람이 손으로도 고친다. */
export function parseInquiryListQuery(params: RawParams): InquiryListQuery {
  const status = readParam(params, "status");
  const sort = readParam(params, "sort");
  const page = Number.parseInt(readParam(params, "page") ?? "1", 10);
  const group = readParam(params, "group");
  const type = readParam(params, "type");

  return {
    group: group && group !== "all" ? group : null,
    type: type && type !== "all" ? type : null,
    status: STATUSES.includes(status as InquiryStatus) ? (status as InquiryStatus) : null,
    q: (readParam(params, "q") ?? "").trim(),
    sort: SORTS.includes(sort as InquirySort) ? (sort as InquirySort) : "newest",
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  };
}

/** 기본값과 같은 항목은 빼서 URL을 짧게 유지한다. 전부 기본값이면 빈 문자열. */
export function toInquiryListSearch(query: InquiryListQuery): string {
  const params = new URLSearchParams();
  if (query.group) params.set("group", query.group);
  if (query.type) params.set("type", query.type);
  if (query.status) params.set("status", query.status);
  if (query.q) params.set("q", query.q);
  if (query.sort !== "newest") params.set("sort", query.sort);
  if (query.page > 1) params.set("page", String(query.page));
  return params.toString();
}

/** 목록 화면으로 돌아가는 링크. */
export function inquiryListHref(gameId: string, query: InquiryListQuery): string {
  const search = toInquiryListSearch(query);
  return search ? `/games/${gameId}/inquiries?${search}` : `/games/${gameId}/inquiries`;
}

/** 상세로 들어갈 때 목록 상태를 같이 들고 간다. 이전/다음 이동과 "← 목록"이 이걸 쓴다. */
export function inquiryDetailHref(inquiryId: string, query: InquiryListQuery): string {
  const search = toInquiryListSearch(query);
  return search ? `/inquiries/${inquiryId}?list=${encodeURIComponent(search)}` : `/inquiries/${inquiryId}`;
}
