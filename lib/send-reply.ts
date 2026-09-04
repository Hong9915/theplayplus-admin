import type { SupabaseClient } from "@supabase/supabase-js";
import { mailboxSender, sendReplyEmail, type SentEmail } from "@/lib/gmail";
import { AUTO_REPLY_ACTOR, recordEvent } from "@/lib/events";
import { createOutboundMessage, listRfcMessageIds } from "@/lib/messages";
import { listCategoryLabelsForScope, type CategoryLabelMaps } from "@/lib/categories";
import { scopeForGameId } from "@/lib/inbox-scope";
import { COMPANY, renderReplyEmailHtml, renderReplyEmailText } from "@/lib/email-template";
import { EMAIL_LOGO_CID, EMAIL_LOGO_CONTENT_TYPE, EMAIL_LOGO_FILENAME, getEmailLogo } from "@/lib/email-logo";
import type { AdminSession } from "@/lib/require-admin-session";

/**
 * 답변 발송의 공용 경로. 관리자가 대화 열에서 보내는 수동 답변과 새 문의에
 * 자동으로 나가는 매크로 답변이 같은 메일 조립·Gmail 발송·기록 코드를 쓴다.
 * 둘의 차이는 mode 하나다:
 *
 * - manual: 상태를 처리중으로 바꾸고 마지막 답변(reply_content/replied_at)을
 *   갱신하며 초안을 비운다. 기록에는 보낸 관리자가 남는다.
 * - auto: 접수 확인 성격이라 상태와 마지막 답변은 건드리지 않는다. 후속
 *   수동 답변이 같은 스레드에 붙도록 gmail_thread_id만 저장하고, 메시지에
 *   auto_sent를 표시해 타임라인이 "자동 발송"으로 구분한다.
 */

/** 답변에 필요한 문의 컬럼. 호출부가 이 select로 읽어 넘긴다. */
export const REPLYABLE_INQUIRY_COLUMNS =
  "id, game_id, group_key, type_key, game_account, reply_email, title, content, inquiry_no, gmail_thread_id";

export interface ReplyableInquiry {
  id: string;
  game_id: string | null;
  group_key: string;
  type_key: string;
  game_account: string | null;
  reply_email: string;
  title: string;
  content: string;
  inquiry_no: string | null;
  gmail_thread_id: string | null;
}

export type SendReplyInput =
  | { inquiry: ReplyableInquiry; body: string; mode: "manual"; actor: AdminSession }
  | { inquiry: ReplyableInquiry; body: string; mode: "auto" };

export interface SendReplyResult {
  sent: SentEmail;
  /** inquiry_messages 기록 성공 여부. 메일은 이미 나갔으므로 실패해도 되돌릴 수 없다. */
  recorded: boolean;
}

/** 메일은 나갔는데 inquiries 갱신에 실패했을 때. 호출부가 발송 실패와 구분해 응답한다. */
export class ReplySaveError extends Error {
  constructor() {
    super("reply_save_failed");
    this.name = "ReplySaveError";
  }
}

const EMPTY_LABELS: CategoryLabelMaps = { groupLabels: {}, typeLabels: {}, typeOrder: [] };

async function fetchGameName(supabase: SupabaseClient, gameId: string): Promise<string | null> {
  const { data, error } = await supabase.from("games").select("name").eq("id", gameId).single();
  if (error || !data) return null;
  return data.name ?? null;
}

/** 발송 실패는 Gmail 오류를 그대로 던진다. 갱신 실패는 ReplySaveError. */
export async function sendInquiryReply(supabase: SupabaseClient, input: SendReplyInput): Promise<SendReplyResult> {
  const { inquiry, body } = input;

  // 접수번호를 제목에 넣어 사용자가 메일로 다시 문의해도 건을 특정할 수 있게 한다.
  // 같은 제목이어야 Gmail이 후속 답변을 같은 스레드로 묶는다.
  const subject = inquiry.inquiry_no ? `[${inquiry.inquiry_no}] Re: ${inquiry.title}` : `Re: ${inquiry.title}`;

  // 이전에 오간 메일이 있으면 그 Message-ID를 참조해 같은 스레드에 붙인다.
  // 게임 이름과 유형 라벨은 메일 꾸밈용이라 못 가져와도 발송은 진행한다.
  // 서비스 문의(game_id null)는 게임명 없이 전역 서비스 카테고리 라벨을 쓴다.
  const scope = scopeForGameId(inquiry.game_id);
  // 게임 문의와 서비스 문의는 다른 Gmail 계정에서 나간다. 푸터 주소도 그 계정을 따른다.
  const mailbox = scope.kind;
  const [references, gameName, labels] = await Promise.all([
    listRfcMessageIds(supabase, inquiry.id).catch(() => [] as string[]),
    inquiry.game_id ? fetchGameName(supabase, inquiry.game_id).catch(() => null) : Promise.resolve(null),
    listCategoryLabelsForScope(supabase, scope).catch(() => EMPTY_LABELS),
  ]);

  const emailInput = {
    gameName: gameName ?? "THE PLAY+",
    gameAccount: inquiry.game_account ?? null,
    replyBody: body,
    inquiry: {
      inquiryNo: inquiry.inquiry_no ?? null,
      groupLabel: labels.groupLabels[inquiry.group_key] ?? null,
      typeLabel: labels.typeLabels[inquiry.type_key] ?? null,
      title: inquiry.title,
      content: inquiry.content,
    },
    logoCid: EMAIL_LOGO_CID,
    contactUrl: COMPANY.siteUrl,
    contactEmail: mailboxSender(mailbox),
  };

  const sent = await sendReplyEmail({
    mailbox,
    to: inquiry.reply_email,
    subject,
    body: renderReplyEmailText(emailInput),
    html: renderReplyEmailHtml(emailInput),
    inlineImages: [
      { cid: EMAIL_LOGO_CID, contentType: EMAIL_LOGO_CONTENT_TYPE, filename: EMAIL_LOGO_FILENAME, data: getEmailLogo() },
    ],
    threadId: inquiry.gmail_thread_id ?? null,
    references,
  });

  const sentAt = new Date().toISOString();
  const gmailThreadId = sent.gmailThreadId || inquiry.gmail_thread_id || null;
  const patch =
    input.mode === "manual"
      ? {
          // 답변을 보냈다고 끝난 건 아니다. 사용자 회신이나 후속 확인이 남을 수
          // 있으니 처리중으로 두고, 완료는 관리자가 직접 바꾼다.
          status: "in_progress",
          // reply_content는 "마지막 답변"이다. 전체 기록은 inquiry_messages에 쌓인다.
          reply_content: body,
          replied_at: sentAt,
          // 발송했으니 초안은 비운다.
          draft_reply: null,
          gmail_thread_id: gmailThreadId,
        }
      : { gmail_thread_id: gmailThreadId };

  const { error: updateError } = await supabase.from("inquiries").update(patch).eq("id", inquiry.id);
  if (updateError) {
    throw new ReplySaveError();
  }

  const actor = input.mode === "manual" ? input.actor : null;

  // 메일은 이미 나갔으므로 기록 실패로 발송을 되돌릴 수는 없다. 대신 결과로
  // 알려 호출부가 스레드에 빠진 답변이 있음을 관리자에게 보이게 한다.
  const recorded = await createOutboundMessage(supabase, {
    inquiryId: inquiry.id,
    author: actor,
    body,
    gmailMessageId: sent.gmailMessageId || null,
    rfcMessageId: sent.rfcMessageId,
    sentAt,
    autoSent: input.mode === "auto",
  }).catch(() => false);

  // 이력 적재는 부가 작업이다. 실패해도 이미 나간 메일을 되돌릴 수 없다.
  await recordEvent(supabase, {
    inquiryId: inquiry.id,
    actor: actor ?? AUTO_REPLY_ACTOR,
    kind: input.mode === "manual" ? "reply_sent" : "auto_reply_sent",
  }).catch(() => {});

  return { sent, recorded };
}
