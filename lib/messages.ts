import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminSession } from "@/lib/require-admin-session";

export type MessageDirection = "outbound" | "inbound";

export interface MessageRow {
  id: string;
  direction: MessageDirection;
  authorEmail: string | null;
  body: string;
  gmailMessageId: string | null;
  rfcMessageId: string | null;
  sentAt: string;
}

export interface CreateOutboundMessageInput {
  inquiryId: string;
  author: AdminSession;
  body: string;
  gmailMessageId: string | null;
  rfcMessageId: string | null;
  sentAt?: string;
}

export interface CreateInboundMessageInput {
  inquiryId: string;
  fromEmail: string | null;
  body: string;
  gmailMessageId: string;
  rfcMessageId: string | null;
  sentAt: string;
}

const COLUMNS = "id, direction, author_email, body, gmail_message_id, rfc_message_id, sent_at";

function mapRow(row: {
  id: string;
  direction: string;
  author_email: string | null;
  body: string;
  gmail_message_id: string | null;
  rfc_message_id: string | null;
  sent_at: string;
}): MessageRow {
  return {
    id: row.id,
    direction: row.direction as MessageDirection,
    authorEmail: row.author_email,
    body: row.body,
    gmailMessageId: row.gmail_message_id,
    rfcMessageId: row.rfc_message_id,
    sentAt: row.sent_at,
  };
}

/** 문의 하나의 대화 기록. 오래된 것부터. */
export async function listMessages(supabase: SupabaseClient, inquiryId: string): Promise<MessageRow[]> {
  const { data, error } = await supabase
    .from("inquiry_messages")
    .select(COLUMNS)
    .eq("inquiry_id", inquiryId)
    .order("sent_at", { ascending: true });

  if (error || !data) {
    return [];
  }
  return data.map(mapRow);
}

/**
 * 다음 답변을 같은 Gmail 스레드에 묶으려면 지금까지 오간 메일의 Message-ID가
 * 필요하다. 오래된 순으로 돌려주므로 마지막 것이 In-Reply-To가 된다.
 */
export async function listRfcMessageIds(supabase: SupabaseClient, inquiryId: string): Promise<string[]> {
  const messages = await listMessages(supabase, inquiryId);
  return messages
    .map((message) => message.rfcMessageId)
    .filter((id): id is string => typeof id === "string" && id !== "");
}

/**
 * 메모와 마찬가지로 실패를 삼키지 않는다. 메일은 이미 나갔으므로 호출부가
 * 되돌릴 수는 없지만, 기록이 빠졌다는 사실은 알려야 한다.
 */
export async function createOutboundMessage(
  supabase: SupabaseClient,
  input: CreateOutboundMessageInput
): Promise<boolean> {
  const { error } = await supabase.from("inquiry_messages").insert({
    inquiry_id: input.inquiryId,
    direction: "outbound",
    author_email: input.author.email,
    body: input.body,
    gmail_message_id: input.gmailMessageId,
    rfc_message_id: input.rfcMessageId,
    ...(input.sentAt ? { sent_at: input.sentAt } : {}),
  });
  return !error;
}

/**
 * 회신 동기화용. gmail_message_id에 부분 유니크 인덱스가 있어 같은 메일을
 * 두 번 넣으면 실패하는데, 그건 "이미 있음"이지 오류가 아니다. 새로 들어간
 * 경우에만 true.
 */
export async function createInboundMessage(
  supabase: SupabaseClient,
  input: CreateInboundMessageInput
): Promise<boolean> {
  const { error } = await supabase.from("inquiry_messages").insert({
    inquiry_id: input.inquiryId,
    direction: "inbound",
    author_email: input.fromEmail,
    body: input.body,
    gmail_message_id: input.gmailMessageId,
    rfc_message_id: input.rfcMessageId,
    sent_at: input.sentAt,
  });
  return !error;
}

/** 이미 저장된 Gmail message id 집합. 동기화 때 건너뛸 기준. */
export async function listGmailMessageIds(supabase: SupabaseClient, inquiryId: string): Promise<Set<string>> {
  const messages = await listMessages(supabase, inquiryId);
  return new Set(
    messages.map((message) => message.gmailMessageId).filter((id): id is string => typeof id === "string")
  );
}
