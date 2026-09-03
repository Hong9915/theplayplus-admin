import type { SupabaseClient } from "@supabase/supabase-js";
import { PAGE_SIZE, type InquiryListQuery } from "@/lib/inquiry-filters";

export type InquiryStatus = "new" | "in_progress" | "resolved";
export type InquiryPriority = "urgent" | "high" | "normal" | "low";

export interface InquiryRow {
  id: string;
  inquiryNo: string | null;
  gameId: string;
  groupKey: string;
  typeKey: string;
  gameAccount: string | null;
  companyName: string | null;
  replyEmail: string;
  title: string;
  content: string;
  status: InquiryStatus;
  priority: InquiryPriority;
  meta: Record<string, unknown>;
  draftReply: string | null;
  replyContent: string | null;
  repliedAt: string | null;
  gmailThreadId: string | null;
  /** 접수 폼 언어 (ko / zh / en). 예전 행은 null. */
  locale: string | null;
  /** 유형별 추가 항목. 접수 폼이 유형 플래그(collects_*)에 따라 채운다. */
  paymentNo: string | null;
  /** datetime-local 문자열 (YYYY-MM-DDTHH:mm). */
  occurredAt: string | null;
  deviceInfo: string | null;
  createdAt: string;
}

export interface AttachmentWithUrl {
  id: string;
  fileName: string;
  signedUrl: string | null;
}

function mapInquiryRow(row: {
  id: string;
  inquiry_no: string | null;
  game_id: string;
  group_key: string;
  type_key: string;
  game_account: string | null;
  company_name: string | null;
  reply_email: string;
  title: string;
  content: string;
  status: string;
  priority: string | null;
  meta: Record<string, unknown> | null;
  draft_reply: string | null;
  reply_content: string | null;
  replied_at: string | null;
  gmail_thread_id?: string | null;
  locale?: string | null;
  payment_no?: string | null;
  occurred_at?: string | null;
  device_info?: string | null;
  created_at: string;
}): InquiryRow {
  return {
    id: row.id,
    inquiryNo: row.inquiry_no ?? null,
    gameId: row.game_id,
    groupKey: row.group_key,
    typeKey: row.type_key,
    gameAccount: row.game_account,
    companyName: row.company_name,
    replyEmail: row.reply_email,
    title: row.title,
    content: row.content,
    status: row.status as InquiryStatus,
    priority: (row.priority ?? "normal") as InquiryPriority,
    meta: row.meta ?? {},
    draftReply: row.draft_reply ?? null,
    replyContent: row.reply_content,
    repliedAt: row.replied_at,
    gmailThreadId: row.gmail_thread_id ?? null,
    locale: row.locale ?? null,
    paymentNo: row.payment_no ?? null,
    occurredAt: row.occurred_at ?? null,
    deviceInfo: row.device_info ?? null,
    createdAt: row.created_at,
  };
}

export interface InquiryPage {
  rows: InquiryRow[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * PostgREST의 or() 필터는 쉼표와 괄호로 조건을 나누므로 검색어에 들어 있으면
 * 문법이 깨진다. 와일드카드(%, _)도 사용자가 의도한 게 아니니 지운다.
 */
export function sanitizeSearch(q: string): string {
  return q.replace(/[,()%_]/g, " ").replace(/\s+/g, " ").trim();
}

// supabase-js 빌더의 정확한 제네릭을 여기서 다 적으면 읽기 어렵다.
// 필요한 메서드만 가진 최소 형태로 다룬다.
export const STALE_AFTER_MS = 72 * 60 * 60 * 1000;

interface FilterBuilder {
  eq(column: string, value: string): FilterBuilder;
  neq(column: string, value: string): FilterBuilder;
  lt(column: string, value: string): FilterBuilder;
  or(filters: string): FilterBuilder;
  order(column: string, options: { ascending: boolean }): FilterBuilder;
  range(from: number, to: number): FilterBuilder;
  limit(count: number): FilterBuilder;
}

function applyFilters<T extends FilterBuilder>(builder: T, gameId: string, query: InquiryListQuery, now: Date): T {
  let next = builder.eq("game_id", gameId) as T;
  if (query.group) next = next.eq("group_key", query.group) as T;
  if (query.type) next = next.eq("type_key", query.type) as T;
  if (query.status) next = next.eq("status", query.status) as T;
  if (query.priority) next = next.eq("priority", query.priority) as T;
  if (query.stale) {
    // "3일 이상 미처리": 완료가 아니면서 접수 후 72시간이 지난 건.
    const cutoff = new Date(now.getTime() - STALE_AFTER_MS).toISOString();
    next = next.neq("status", "resolved").lt("created_at", cutoff) as T;
  }

  const q = sanitizeSearch(query.q);
  if (q) {
    const pattern = `%${q}%`;
    next = next.or(
      `title.ilike.${pattern},inquiry_no.ilike.${pattern},game_account.ilike.${pattern},content.ilike.${pattern}`
    ) as T;
  }
  return next;
}

function applyOrder<T extends FilterBuilder>(builder: T, query: InquiryListQuery): T {
  switch (query.sort) {
    case "oldest":
      return builder.order("created_at", { ascending: true }) as T;
    case "priority":
      // priority_rank는 마이그레이션 0005의 생성 컬럼(urgent=0 … low=3).
      return builder.order("priority_rank", { ascending: true }).order("created_at", { ascending: false }) as T;
    default:
      return builder.order("created_at", { ascending: false }) as T;
  }
}

/** 목록 한 페이지. 필터·정렬·검색을 DB에서 처리해야 문의가 쌓여도 버틴다. */
export async function queryInquiries(
  supabase: SupabaseClient,
  gameId: string,
  query: InquiryListQuery,
  options: { now?: Date } = {}
): Promise<InquiryPage> {
  const now = options.now ?? new Date();
  const from = (query.page - 1) * PAGE_SIZE;
  const builder = applyOrder(
    applyFilters(supabase.from("inquiries").select("*", { count: "exact" }) as unknown as FilterBuilder, gameId, query, now),
    query
  ).range(from, from + PAGE_SIZE - 1);

  const { data, error, count } = await (builder as unknown as PromiseLike<{
    data: Parameters<typeof mapInquiryRow>[0][] | null;
    error: { message: string } | null;
    count: number | null;
  }>);

  if (error) {
    throw new Error(`Failed to list inquiries: ${error.message}`);
  }
  return { rows: (data ?? []).map(mapInquiryRow), total: count ?? 0, page: query.page, pageSize: PAGE_SIZE };
}

/**
 * 같은 조건·정렬의 id 목록. 상세에서 이전/다음 문의로 옮겨 다닐 때 쓴다.
 * 페이지와 무관하게 전체를 보되, 비정상적으로 큰 목록은 잘라낸다.
 */
export async function listInquiryIds(
  supabase: SupabaseClient,
  gameId: string,
  query: InquiryListQuery,
  options: { limit?: number; now?: Date } = {}
): Promise<string[]> {
  const limit = options.limit ?? 1000;
  const now = options.now ?? new Date();
  const builder = applyOrder(
    applyFilters(supabase.from("inquiries").select("id") as unknown as FilterBuilder, gameId, query, now),
    query
  ).limit(limit);

  const { data, error } = await (builder as unknown as PromiseLike<{
    data: Array<{ id: string }> | null;
    error: { message: string } | null;
  }>);

  if (error || !data) {
    return [];
  }
  return data.map((row) => row.id);
}

export async function countInquiriesByGame(supabase: SupabaseClient, gameId: string): Promise<number> {
  const { count } = await supabase.from("inquiries").select("id", { count: "exact", head: true }).eq("game_id", gameId);
  return count ?? 0;
}

/** 게임별 미처리(new) 건수. 게임 레일의 배지가 쓴다. */
export async function countNewInquiriesByGame(supabase: SupabaseClient): Promise<Record<string, number>> {
  const { data, error } = await supabase.from("inquiries").select("game_id").eq("status", "new");
  if (error || !data) {
    return {};
  }
  const counts: Record<string, number> = {};
  for (const row of data as Array<{ game_id: string | null }>) {
    if (!row.game_id) continue;
    counts[row.game_id] = (counts[row.game_id] ?? 0) + 1;
  }
  return counts;
}

export async function getInquiryById(supabase: SupabaseClient, id: string): Promise<InquiryRow | null> {
  const { data, error } = await supabase.from("inquiries").select("*").eq("id", id).single();
  if (error || !data) {
    return null;
  }
  return mapInquiryRow(data);
}

export async function listAttachmentSignedUrls(
  supabase: SupabaseClient,
  inquiryId: string
): Promise<AttachmentWithUrl[]> {
  const { data, error } = await supabase
    .from("inquiry_attachments")
    .select("id, file_path, file_name")
    .eq("inquiry_id", inquiryId);

  if (error || !data) {
    return [];
  }

  const results: AttachmentWithUrl[] = [];
  for (const attachment of data) {
    const { data: signed } = await supabase.storage
      .from("inquiry-attachments")
      .createSignedUrl(attachment.file_path, 3600);
    results.push({ id: attachment.id, fileName: attachment.file_name, signedUrl: signed?.signedUrl ?? null });
  }
  return results;
}

export interface InquiryFacetCounts {
  total: number;
  status: Record<InquiryStatus, number>;
  type: Record<string, number>;
  priority: Record<InquiryPriority, number>;
  stale: number;
}

const STATUS_KEYS: InquiryStatus[] = ["new", "in_progress", "resolved"];
const PRIORITY_KEYS: InquiryPriority[] = ["urgent", "high", "normal", "low"];

/**
 * 문의함 보기 열의 건수. 마이그레이션 0008의 inquiry_facet_counts RPC 한 번으로
 * 가져온다. 실패하면 null — 건수는 부가 정보라 목록 표시를 막지 않는다.
 */
export async function getInquiryFacetCounts(
  supabase: SupabaseClient,
  gameId: string
): Promise<InquiryFacetCounts | null> {
  const { data, error } = await supabase.rpc("inquiry_facet_counts", { p_game_id: gameId });
  if (error || !data) {
    return null;
  }

  const counts: InquiryFacetCounts = {
    total: 0,
    status: { new: 0, in_progress: 0, resolved: 0 },
    type: {},
    priority: { urgent: 0, high: 0, normal: 0, low: 0 },
    stale: 0,
  };

  for (const row of data as Array<{ facet: string; key: string; count: number | string }>) {
    const count = Number(row.count) || 0;
    switch (row.facet) {
      case "status":
        if (STATUS_KEYS.includes(row.key as InquiryStatus)) counts.status[row.key as InquiryStatus] = count;
        break;
      case "type":
        counts.type[row.key] = count;
        break;
      case "priority":
        if (PRIORITY_KEYS.includes(row.key as InquiryPriority)) counts.priority[row.key as InquiryPriority] = count;
        break;
      case "stale":
        counts.stale = count;
        break;
      case "total":
        counts.total = count;
        break;
    }
  }
  return counts;
}
