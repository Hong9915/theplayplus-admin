import type { SupabaseClient } from "@supabase/supabase-js";

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
    createdAt: row.created_at,
  };
}

export async function listInquiriesByGame(
  supabase: SupabaseClient,
  gameId: string,
  status?: InquiryStatus
): Promise<InquiryRow[]> {
  let query = supabase.from("inquiries").select("*").eq("game_id", gameId);
  if (status) {
    query = query.eq("status", status);
  }
  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list inquiries: ${error.message}`);
  }
  return (data ?? []).map(mapInquiryRow);
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
