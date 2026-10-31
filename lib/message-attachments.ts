import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InboundAttachmentRef, MailAttachment } from "@/lib/gmail";
import {
  ATTACHMENT_BUCKET,
  isAllowedImageType,
  isMessageAttachmentPathOf,
  MAX_REPLY_IMAGES,
  MAX_REPLY_TOTAL_BYTES,
  messageAttachmentPath,
  safeFileName,
} from "@/lib/attachment-rules";

/**
 * 답변·회신 사진. 둘 다 문의 첨부와 같은 inquiry_attachments 표·inquiry-attachments
 * 버킷에 두고 message_id로 어느 메시지에 딸린 것인지 표시한다(마이그레이션 0035).
 *
 * - 답변: 작성란이 서명 업로드 주소로 버킷에 먼저 올린다(Vercel 함수 본문 4.5MB 제한을
 *   피하려고). 발송할 때 그 경로를 받아 내려받아 메일에 붙이고, 기록된 메시지 id로 행을 넣는다.
 * - 회신: 동기화가 Gmail에서 사진을 내려받아 버킷에 올리고 inbound 메시지 id로 행을 넣는다.
 */

/** 작성란이 보내는 답변 사진. 경로는 업로드 주소를 받을 때 서버가 정해 준 값이다. */
export interface ReplyAttachmentRef {
  path: string;
  fileName: string;
}

/** 답변 사진을 못 붙였을 때. 사진 없이 나가면 안 되므로 발송 전에 멈춘다. */
export class ReplyAttachmentError extends Error {
  constructor(reason: string) {
    super(`reply_attachment_failed: ${reason}`);
    this.name = "ReplyAttachmentError";
  }
}

/** 버킷에 올라간 답변 사진을 메일 첨부로 읽는다. 하나라도 못 읽으면 ReplyAttachmentError. */
export async function loadReplyAttachments(
  supabase: SupabaseClient,
  inquiryId: string,
  refs: ReplyAttachmentRef[]
): Promise<MailAttachment[]> {
  if (refs.length === 0) return [];
  if (refs.length > MAX_REPLY_IMAGES) throw new ReplyAttachmentError("too_many");

  const loaded = await Promise.all(
    refs.map(async (ref) => {
      if (!isMessageAttachmentPathOf(inquiryId, ref.path)) throw new ReplyAttachmentError("bad_path");
      const { data: blob, error } = await supabase.storage.from(ATTACHMENT_BUCKET).download(ref.path);
      if (error || !blob) throw new ReplyAttachmentError("download_failed");
      if (!isAllowedImageType(blob.type)) throw new ReplyAttachmentError("bad_type");
      return { contentType: blob.type, filename: ref.fileName, data: Buffer.from(await blob.arrayBuffer()) };
    })
  );
  const total = loaded.reduce((sum, file) => sum + file.data.length, 0);
  if (total > MAX_REPLY_TOTAL_BYTES) throw new ReplyAttachmentError("too_large");
  return loaded;
}

/** 첨부 행을 메시지에 묶어 넣는다. 실패해도 메일은 이미 나갔으므로 결과만 알린다. */
export async function recordMessageAttachments(
  supabase: SupabaseClient,
  input: { inquiryId: string; messageId: string; files: ReplyAttachmentRef[] }
): Promise<boolean> {
  if (input.files.length === 0) return true;
  const { error } = await supabase.from("inquiry_attachments").insert(
    input.files.map((file) => ({
      inquiry_id: input.inquiryId,
      message_id: input.messageId,
      file_path: file.path,
      file_name: file.fileName,
    }))
  );
  if (error) console.warn("[attachments] 메시지 첨부 행 저장 실패", input.messageId, error);
  return !error;
}

/**
 * 회신 사진을 Gmail에서 내려받아 버킷에 올리고 그 회신 메시지에 묶는다. 사진 하나가
 * 실패해도 나머지는 계속한다(회신 본문은 이미 저장됐다). 저장한 장수를 돌려준다.
 */
export async function saveInboundAttachments(
  supabase: SupabaseClient,
  input: {
    inquiryId: string;
    messageId: string;
    attachments: InboundAttachmentRef[];
    download: (attachmentId: string) => Promise<Buffer>;
  }
): Promise<number> {
  const saved: ReplyAttachmentRef[] = [];
  for (const attachment of input.attachments) {
    try {
      const data = await input.download(attachment.attachmentId);
      const fileName = safeFileName(attachment.filename, attachment.mimeType);
      const path = messageAttachmentPath(input.inquiryId, fileName, randomUUID());
      const { error } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .upload(path, data, { contentType: attachment.mimeType, upsert: false });
      if (error) throw error;
      saved.push({ path, fileName: attachment.filename || fileName });
    } catch (error) {
      console.warn("[attachments] 회신 사진 저장 실패", input.messageId, attachment.filename, error);
    }
  }
  if (saved.length === 0) return 0;
  const recorded = await recordMessageAttachments(supabase, {
    inquiryId: input.inquiryId,
    messageId: input.messageId,
    files: saved,
  });
  if (!recorded) {
    // 행이 없으면 화면에서 안 보이니 올린 파일도 치운다.
    await supabase.storage.from(ATTACHMENT_BUCKET).remove(saved.map((file) => file.path)).catch(() => {});
    return 0;
  }
  return saved.length;
}
