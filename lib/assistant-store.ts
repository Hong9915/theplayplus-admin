import type { SupabaseClient } from "@supabase/supabase-js";
import type { Proposal } from "@/lib/sheets";
import type { Attachment } from "@/lib/attachments";
import { HISTORY_LIMIT, type HistoryMessage, type ProposalStatus } from "@/lib/assistant";

export interface ConversationRow {
  id: string;
  gameId: string;
  title: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type MessageRole = "user" | "assistant" | "proposal";

export interface MessageRow {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  proposal: Proposal | null;
  status: ProposalStatus | null;
  failureReason: string | null;
  appliedBy: string | null;
  appliedAt: string | null;
  /** 사용자 메시지에 딸린 파일. 원본은 없고 뽑아낸 텍스트만 있다. */
  attachments: Attachment[];
  createdAt: string;
}

const TITLE_LENGTH = 40;

export function conversationTitle(firstMessage: string): string {
  const trimmed = firstMessage.trim().replace(/\s+/g, " ");
  if (!trimmed) return "새 대화";
  return Array.from(trimmed).slice(0, TITLE_LENGTH).join("");
}

function mapConversation(row: {
  id: string;
  game_id: string;
  title: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}): ConversationRow {
  return { id: row.id, gameId: row.game_id, title: row.title, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapMessage(row: {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  proposal: Proposal | null;
  status: string | null;
  failure_reason: string | null;
  applied_by: string | null;
  applied_at: string | null;
  attachments?: Attachment[] | null;
  created_at: string;
}): MessageRow {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as MessageRole,
    content: row.content,
    proposal: row.proposal,
    status: (row.status as ProposalStatus | null) ?? null,
    failureReason: row.failure_reason,
    appliedBy: row.applied_by,
    appliedAt: row.applied_at,
    attachments: row.attachments ?? [],
    createdAt: row.created_at,
  };
}

export async function listConversations(supabase: SupabaseClient, gameId: string): Promise<ConversationRow[]> {
  const { data, error } = await supabase
    .from("assistant_conversations")
    .select("*")
    .eq("game_id", gameId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Failed to list conversations: ${error.message}`);
  return (data ?? []).map(mapConversation);
}

export async function getConversation(supabase: SupabaseClient, id: string): Promise<ConversationRow | null> {
  const { data, error } = await supabase.from("assistant_conversations").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return mapConversation(data);
}

export async function createConversation(
  supabase: SupabaseClient,
  input: { gameId: string; title: string; createdBy: string }
): Promise<ConversationRow | null> {
  const { data, error } = await supabase
    .from("assistant_conversations")
    .insert({ game_id: input.gameId, title: input.title, created_by: input.createdBy })
    .select("*")
    .single();
  if (error || !data) return null;
  return mapConversation(data);
}

export async function deleteConversation(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { error } = await supabase.from("assistant_conversations").delete().eq("id", id);
  return !error;
}

/** 목록 정렬용. 메시지가 오갈 때마다 updated_at을 올린다. */
export async function touchConversation(supabase: SupabaseClient, id: string): Promise<void> {
  await supabase.from("assistant_conversations").update({ updated_at: new Date().toISOString() }).eq("id", id);
}

export async function listMessages(supabase: SupabaseClient, conversationId: string): Promise<MessageRow[]> {
  const { data, error } = await supabase
    .from("assistant_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Failed to list messages: ${error.message}`);
  return (data ?? []).map(mapMessage);
}

export async function getMessage(supabase: SupabaseClient, id: string): Promise<MessageRow | null> {
  const { data, error } = await supabase.from("assistant_messages").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return mapMessage(data);
}

export async function insertMessage(
  supabase: SupabaseClient,
  input: { conversationId: string; role: MessageRole; content?: string; proposal?: Proposal; status?: ProposalStatus; attachments?: Attachment[] }
): Promise<MessageRow | null> {
  const { data, error } = await supabase
    .from("assistant_messages")
    .insert({
      conversation_id: input.conversationId,
      role: input.role,
      content: input.content ?? "",
      proposal: input.proposal ?? null,
      status: input.status ?? null,
      attachments: input.attachments ?? null,
    })
    .select("*")
    .single();
  if (error || !data) return null;
  return mapMessage(data);
}

export async function updateProposalStatus(
  supabase: SupabaseClient,
  id: string,
  patch: { status: ProposalStatus; failureReason?: string | null; appliedBy?: string | null; appliedAt?: string | null }
): Promise<boolean> {
  const { error } = await supabase
    .from("assistant_messages")
    .update({
      status: patch.status,
      failure_reason: patch.failureReason ?? null,
      applied_by: patch.appliedBy ?? null,
      applied_at: patch.appliedAt ?? null,
    })
    .eq("id", id);
  return !error;
}

/** 모델에 넘길 이력. 최근 HISTORY_LIMIT개만. */
export function toHistory(messages: MessageRow[]): HistoryMessage[] {
  return messages.slice(-HISTORY_LIMIT).map((message) => ({
    role: message.role,
    content: message.content,
    proposal: message.proposal,
    status: message.status,
    attachmentNames: message.attachments.map((attachment) => attachment.name),
  }));
}
