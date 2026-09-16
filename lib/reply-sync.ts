import type { SupabaseClient } from "@supabase/supabase-js";
import { openMailbox, type InboundMessageRef, type Mailbox, type MailboxReader } from "@/lib/gmail";
import { createInboundMessage } from "@/lib/messages";

/**
 * 사용자 회신 자동 동기화. pg_cron이 5분마다 /api/replies/sync를 부르면
 * 발신 메일함마다 "마지막 확인 이후 받은 메일"의 id·스레드 id를 한 번에 가져와
 * 스레드 id로 문의에 맞추고, 맞은 메일만 본문을 읽어 inquiry_messages에
 * inbound로 넣는다(마이그레이션 0017). info@처럼 무관한 메일이 많은 계정에서도
 * 본문 조회는 문의 회신 수만큼만 일어난다.
 *
 * 마지막 확인 시각은 gmail_sync_state에 메일함별로 저장한다. 조회는 그보다
 * 10분 앞에서 시작해 경계에 걸친 메일을 놓치지 않는데, 겹치는 구간의 메일은
 * gmail_message_id 유니크 인덱스가 걸러 준다.
 */

export interface MailboxSyncResult {
  mailbox: Mailbox;
  /** Gmail에서 받아온 메일 수 */
  fetched: number;
  /** 문의와 스레드가 맞은 메일 수 */
  matched: number;
  /** 새로 저장한 회신 수 */
  added: number;
  error?: "fetch_failed";
}

export interface SyncOptions {
  now?: Date;
}

const LOOKBACK_MS = 10 * 60 * 1000;
const FIRST_RUN_LOOKBACK_MS = 24 * 60 * 60 * 1000;

interface SyncStateRow {
  synced_through: string;
}

interface ThreadInquiryRow {
  id: string;
  gmail_thread_id: string;
  unread_reply_at: string | null;
}

async function readSyncedThrough(supabase: SupabaseClient, mailbox: Mailbox): Promise<Date | null> {
  const { data } = await supabase
    .from("gmail_sync_state")
    .select("synced_through")
    .eq("mailbox", mailbox)
    .maybeSingle();
  const row = data as SyncStateRow | null;
  return row ? new Date(row.synced_through) : null;
}

async function mapThreadsToInquiries(
  supabase: SupabaseClient,
  threadIds: string[]
): Promise<Map<string, ThreadInquiryRow>> {
  const map = new Map<string, ThreadInquiryRow>();
  if (threadIds.length === 0) return map;

  const { data, error } = await supabase
    .from("inquiries")
    .select("id, gmail_thread_id, unread_reply_at")
    .in("gmail_thread_id", threadIds);
  if (error) {
    throw new Error(`Failed to match threads: ${error.message}`);
  }
  for (const row of (data ?? []) as ThreadInquiryRow[]) {
    map.set(row.gmail_thread_id, row);
  }
  return map;
}

/** 이미 저장된 메일은 본문을 다시 읽지 않는다. 10분 겹침 구간이 매번 걸린다. */
async function listKnownMessageIds(supabase: SupabaseClient, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await supabase.from("inquiry_messages").select("gmail_message_id").in("gmail_message_id", ids);
  if (error) {
    throw new Error(`Failed to list known messages: ${error.message}`);
  }
  return new Set(((data ?? []) as Array<{ gmail_message_id: string }>).map((row) => row.gmail_message_id));
}

/**
 * 스레드 id로 못 맞춘 메일을 In-Reply-To·References로 다시 맞춘다. 사용자가
 * 제목을 바꿔 답장하면 Gmail이 새 스레드를 만들어 스레드 id가 어긋나는데,
 * 헤더는 여전히 우리가 보낸 메일의 Message-ID(inquiry_messages.rfc_message_id)를
 * 가리킨다. 메일마다 헤더 조회가 한 번 들어가므로 본문은 맞은 것만 읽는다.
 * 같은 문의를 스레드로도 만난 경우 그 행을 그대로 써 unread 판단을 공유한다.
 */
async function matchStrayRefsByHeaders(
  supabase: SupabaseClient,
  reader: MailboxReader,
  refs: InboundMessageRef[],
  inquiriesByThread: Map<string, ThreadInquiryRow>
): Promise<Array<{ ref: InboundMessageRef; inquiry: ThreadInquiryRow }>> {
  if (refs.length === 0) return [];

  const referencedByRef = new Map<InboundMessageRef, string[]>();
  for (const ref of refs) {
    try {
      const ids = await reader.getReplyHeaders(ref.id);
      if (ids.length > 0) referencedByRef.set(ref, ids);
    } catch (error) {
      console.warn("[reply-sync] 헤더 조회 실패", ref.id, error);
    }
  }
  const allReferenced = Array.from(new Set(Array.from(referencedByRef.values()).flat()));
  if (allReferenced.length === 0) return [];

  const { data: sentRows, error } = await supabase
    .from("inquiry_messages")
    .select("inquiry_id, rfc_message_id")
    .in("rfc_message_id", allReferenced);
  if (error) {
    console.warn("[reply-sync] Message-ID 대조 실패", error);
    return [];
  }
  const inquiryIdByRfc = new Map<string, string>();
  for (const row of (sentRows ?? []) as Array<{ inquiry_id: string; rfc_message_id: string }>) {
    inquiryIdByRfc.set(row.rfc_message_id, row.inquiry_id);
  }

  const inquiryIds = new Set<string>();
  const inquiryIdByRef = new Map<InboundMessageRef, string>();
  for (const [ref, ids] of referencedByRef) {
    const inquiryId = ids.map((id) => inquiryIdByRfc.get(id)).find((id): id is string => !!id);
    if (!inquiryId) continue;
    inquiryIdByRef.set(ref, inquiryId);
    inquiryIds.add(inquiryId);
  }
  if (inquiryIds.size === 0) return [];

  const rowsById = new Map<string, ThreadInquiryRow>();
  for (const row of inquiriesByThread.values()) rowsById.set(row.id, row);
  const missing = Array.from(inquiryIds).filter((id) => !rowsById.has(id));
  if (missing.length > 0) {
    const { data, error: loadError } = await supabase
      .from("inquiries")
      .select("id, gmail_thread_id, unread_reply_at")
      .in("id", missing);
    if (loadError) {
      console.warn("[reply-sync] 문의 조회 실패", loadError);
      return [];
    }
    for (const row of (data ?? []) as ThreadInquiryRow[]) rowsById.set(row.id, row);
  }

  const pairs: Array<{ ref: InboundMessageRef; inquiry: ThreadInquiryRow }> = [];
  for (const [ref, inquiryId] of inquiryIdByRef) {
    const inquiry = rowsById.get(inquiryId);
    if (inquiry) pairs.push({ ref, inquiry });
  }
  return pairs;
}

/** 이미 더 이른 읽지 않은 회신이 있으면 그대로 둔다. 배지는 가장 오래된 회신 기준. */
function earlierUnread(current: string | null, candidate: string): string | null {
  if (current && new Date(current).getTime() <= new Date(candidate).getTime()) return null;
  return candidate;
}

export async function syncMailbox(
  supabase: SupabaseClient,
  mailbox: Mailbox,
  options: SyncOptions = {}
): Promise<MailboxSyncResult> {
  const now = options.now ?? new Date();
  const syncedThrough = await readSyncedThrough(supabase, mailbox);
  const since = syncedThrough
    ? new Date(syncedThrough.getTime() - LOOKBACK_MS)
    : new Date(now.getTime() - FIRST_RUN_LOOKBACK_MS);

  let reader: MailboxReader;
  let refs: InboundMessageRef[];
  try {
    reader = openMailbox(mailbox);
    refs = await reader.listInboundIdsSince(since);
  } catch (error) {
    console.warn(`[reply-sync] ${mailbox} 메일함 조회 실패`, error);
    return { mailbox, fetched: 0, matched: 0, added: 0, error: "fetch_failed" };
  }

  const threadIds = Array.from(new Set(refs.map((ref) => ref.threadId)));
  const inquiriesByThread = await mapThreadsToInquiries(supabase, threadIds);
  // 겹침 구간이나 헤더로 이미 맞춘 메일은 다시 열지 않는다.
  const known = await listKnownMessageIds(
    supabase,
    refs.map((ref) => ref.id)
  );

  const pairs: Array<{ ref: InboundMessageRef; inquiry: ThreadInquiryRow }> = [];
  const strayRefs: InboundMessageRef[] = [];
  for (const ref of refs) {
    if (known.has(ref.id)) continue;
    const inquiry = inquiriesByThread.get(ref.threadId);
    if (inquiry) pairs.push({ ref, inquiry });
    else strayRefs.push(ref);
  }
  pairs.push(...(await matchStrayRefsByHeaders(supabase, reader, strayRefs, inquiriesByThread)));

  let added = 0;
  for (const { ref, inquiry } of pairs) {
    let email;
    try {
      email = await reader.getInboundMessage(ref.id);
    } catch (error) {
      console.warn("[reply-sync] 메일 조회 실패", ref.id, error);
      continue;
    }
    if (!email) continue;
    // 첨부만 있거나 인용문뿐이면 보여줄 게 없다. 버튼 동기화와 같은 기준.
    if (!email.body.trim()) continue;

    const inserted = await createInboundMessage(supabase, {
      inquiryId: inquiry.id,
      fromEmail: email.fromEmail,
      body: email.body,
      gmailMessageId: email.gmailMessageId,
      rfcMessageId: email.rfcMessageId,
      sentAt: email.sentAt,
    });
    if (!inserted) continue;
    added += 1;

    const unreadAt = earlierUnread(inquiry.unread_reply_at, email.sentAt);
    if (unreadAt) {
      const { error } = await supabase.from("inquiries").update({ unread_reply_at: unreadAt }).eq("id", inquiry.id);
      if (error) {
        console.warn("[reply-sync] unread_reply_at 갱신 실패", inquiry.id, error);
      } else {
        inquiry.unread_reply_at = unreadAt;
      }
    }
  }

  const { error: stateError } = await supabase.from("gmail_sync_state").upsert({
    mailbox,
    synced_through: now.toISOString(),
    updated_at: now.toISOString(),
  });
  if (stateError) {
    console.warn(`[reply-sync] ${mailbox} 동기화 시각 저장 실패`, stateError);
  }

  return { mailbox, fetched: refs.length, matched: pairs.length, added };
}

/**
 * 게임·서비스 메일함을 차례로 돈다. 서비스 계정이 설정되지 않아 게임 계정으로
 * 대체되는 경우 발신 주소가 같으니 한 번만 읽는다.
 */
export async function syncAllMailboxes(supabase: SupabaseClient, options: SyncOptions = {}): Promise<MailboxSyncResult[]> {
  const mailboxes: Mailbox[] = ["game", "service"];
  const seen = new Set<string>();
  const results: MailboxSyncResult[] = [];
  for (const mailbox of mailboxes) {
    const sender = mailboxSenderAddress(mailbox);
    if (sender && seen.has(sender)) continue;
    if (sender) seen.add(sender);
    results.push(await syncMailbox(supabase, mailbox, options));
  }
  return results;
}

/** 자격 증명이 없어 열지 못하면 null. syncMailbox가 같은 오류를 fetch_failed로 보고한다. */
function mailboxSenderAddress(mailbox: Mailbox): string | null {
  try {
    return openMailbox(mailbox).sender.trim().toLowerCase();
  } catch {
    return null;
  }
}
