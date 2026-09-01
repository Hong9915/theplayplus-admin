import type { SupabaseClient } from "@supabase/supabase-js";
import type { InquiryStatus } from "@/lib/inquiries";

export interface AccountHistoryEntry {
  id: string;
  title: string;
  status: InquiryStatus;
  groupKey: string;
  typeKey: string;
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
    .select("id, title, status, group_key, type_key, created_at")
    .eq("game_id", gameId)
    .eq("game_account", gameAccount)
    .neq("id", excludeInquiryId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load account history: ${error.message}`);
  }

  return (data ?? []).map((row: { id: string; title: string; status: string; group_key: string; type_key: string; created_at: string }) => ({
    id: row.id,
    title: row.title,
    status: row.status as InquiryStatus,
    groupKey: row.group_key,
    typeKey: row.type_key,
    createdAt: row.created_at,
  }));
}
