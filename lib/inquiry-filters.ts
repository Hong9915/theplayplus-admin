import type { InquiryPriority, InquiryStatus } from "@/lib/inquiries";
import { scopeBasePath, type InboxScope } from "@/lib/inbox-scope";

export type InquirySort = "newest" | "oldest" | "priority";

/**
 * 문의 목록의 필터·정렬·페이지 상태. URL 쿼리가 원본이다 — 상세에 들어갔다
 * 뒤로 와도, 링크를 공유해도 같은 화면이 나와야 한다.
 */
export interface InquiryListQuery {
  group: string | null;
  type: string | null;
  status: InquiryStatus | null;
  priority: InquiryPriority | null;
  /** 완료가 아니면서 접수 후 72시간 지난 건만. */
  stale: boolean;
  /** 아직 열어 보지 않은 사용자 회신이 있는 건만(unread_reply_at 있음). */
  unread: boolean;
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
const PRIORITIES: InquiryPriority[] = ["urgent", "high", "normal", "low"];
const SORTS: InquirySort[] = ["newest", "oldest", "priority"];

export const DEFAULT_QUERY: InquiryListQuery = {
  group: null,
  type: null,
  status: null,
  priority: null,
  stale: false,
  unread: false,
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
  const priority = readParam(params, "priority");

  return {
    group: group && group !== "all" ? group : null,
    type: type && type !== "all" ? type : null,
    status: STATUSES.includes(status as InquiryStatus) ? (status as InquiryStatus) : null,
    priority: PRIORITIES.includes(priority as InquiryPriority) ? (priority as InquiryPriority) : null,
    stale: readParam(params, "stale") === "1",
    unread: readParam(params, "unread") === "1",
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
  if (query.priority) params.set("priority", query.priority);
  if (query.stale) params.set("stale", "1");
  if (query.unread) params.set("unread", "1");
  if (query.q) params.set("q", query.q);
  if (query.sort !== "newest") params.set("sort", query.sort);
  if (query.page > 1) params.set("page", String(query.page));
  return params.toString();
}

/** 목록 화면으로 돌아가는 링크. */
export function inquiryListHref(scope: InboxScope, query: InquiryListQuery): string {
  const search = toInquiryListSearch(query);
  const base = `${scopeBasePath(scope)}/inquiries`;
  return search ? `${base}?${search}` : base;
}

/** 인박스에서 문의 하나를 연 URL. 목록 상태는 같은 URL의 쿼리로 남는다. */
export function inquiryHref(scope: InboxScope, inquiryId: string, query: InquiryListQuery): string {
  const search = toInquiryListSearch(query);
  const base = `${scopeBasePath(scope)}/inquiries/${inquiryId}`;
  return search ? `${base}?${search}` : base;
}

/** 선택된 문의가 있으면 유지한 채, 없으면 목록만 가리키는 URL. 필터·정렬·페이지 이동이 쓴다. */
export function inboxHref(scope: InboxScope, selectedId: string | null, query: InquiryListQuery): string {
  return selectedId ? inquiryHref(scope, selectedId, query) : inquiryListHref(scope, query);
}

/** 예전 /inquiries/{id}?list=... 링크를 새 URL로 옮긴다. Slack에 이미 나간 링크 호환용. */
export function legacyInquiryRedirectHref(
  scope: InboxScope,
  inquiryId: string,
  listParam: string | null | undefined
): string {
  return inquiryHref(scope, inquiryId, parseInquiryListQuery(listParam ?? ""));
}
