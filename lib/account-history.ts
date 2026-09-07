import type { SupabaseClient } from "@supabase/supabase-js";
import type { InquiryStatus } from "@/lib/inquiries";
import { parseTranslations, type Translations } from "@/lib/translations";

export interface AccountHistoryEntry {
  id: string;
  inquiryNo: string | null;
  title: string;
  content: string;
  status: InquiryStatus;
  groupKey: string;
  typeKey: string;
  occurredAt: string | null;
  paymentNo: string | null;
  deviceInfo: string | null;
  translations: Translations;
  createdAt: string;
}

export async function getAccountHistory(
  supabase: SupabaseClient,
  gameId: string,
  gameAccount: string | null,
  excludeInquiryId: string
): Promise<AccountHistoryEntry[]> {
  if (!gameAccount || !gameAccount.trim()) {
    return [];
  }

  const { data, error } = await supabase
    .from("inquiries")
    .select("id, inquiry_no, title, content, status, group_key, type_key, occurred_at, payment_no, device_info, translations, created_at")
    .eq("game_id", gameId)
    .eq("game_account", gameAccount)
    .neq("id", excludeInquiryId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load account history: ${error.message}`);
  }

  return (data ?? []).map((row: { id: string; inquiry_no?: string | null; title: string; content: string | null; status: string; group_key: string; type_key: string; occurred_at?: string | null; payment_no?: string | null; device_info?: string | null; translations?: unknown; created_at: string }) => ({
    id: row.id,
    inquiryNo: row.inquiry_no ?? null,
    title: row.title,
    content: row.content ?? "",
    status: row.status as InquiryStatus,
    groupKey: row.group_key,
    typeKey: row.type_key,
    occurredAt: row.occurred_at ?? null,
    paymentNo: row.payment_no ?? null,
    deviceInfo: row.device_info ?? null,
    translations: parseTranslations(row.translations),
    createdAt: row.created_at,
  }));
}
