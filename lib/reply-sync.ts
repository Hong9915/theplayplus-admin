import type { SupabaseClient } from "@supabase/supabase-js";
import { listInboundSince, mailboxSender, type InboundEmailWithThread, type Mailbox } from "@/lib/gmail";
import { createInboundMessage } from "@/lib/messages";

/**
 * 사용자 회신 자동 동기화. pg_cron이 5분마다 /api/replies/sync를 부르면
 * 발신 메일함마다 "마지막 확인 이후 받은 메일"을 한 번에 가져와 스레드 id로
 * 문의에 맞추고 inquiry_messages에 inbound로 넣는다(마이그레이션 0017).
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

  let inbound: InboundEmailWithThread[];
  try {
    inbound = await listInboundSince(mailbox, since);
  } catch (error) {
    console.warn(`[reply-sync] ${mailbox} 메일함 조회 실패`, error);
    return { mailbox, fetched: 0, matched: 0, added: 0, error: "fetch_failed" };
  }

  const threadIds = Array.from(new Set(inbound.map((email) => email.threadId)));
  const inquiriesByThread = await mapThreadsToInquiries(supabase, threadIds);

  let matched = 0;
  let added = 0;
  for (const email of inbound) {
    const inquiry = inquiriesByThread.get(email.threadId);
    if (!inquiry) continue;
    matched += 1;
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

  return { mailbox, fetched: inbound.length, matched, added };
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
    const sender = mailboxSender(mailbox).trim().toLowerCase();
    if (seen.has(sender)) continue;
    seen.add(sender);
    results.push(await syncMailbox(supabase, mailbox, options));
  }
  return results;
}
