/**
 * 1회성 유틸: 이미 보낸 답변의 rfc_message_id를 Gmail이 실제로 붙인 Message-ID로
 * 바꾼다. 예전에는 우리가 만든 `<uuid@theplayplus.com>`을 저장했지만 Gmail API가
 * 그 값을 `@mail.gmail.com`으로 바꿔 보내므로(2026-09-16 실측) 사용자 회신의
 * In-Reply-To와 맞지 않았다. 새로 보내는 답변은 lib/gmail.ts가 발송 직후 읽어 저장한다.
 *
 * 사용법: .env.local에 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GMAIL_* 값을 채운 뒤
 *   set -a && source .env.local && set +a && npx vite-node --config vitest.config.ts scripts/backfill-rfc-message-ids.ts
 * 다시 실행하면 아직 @mail.gmail.com이 아닌 것만 처리한다.
 */
import { createClient } from "@supabase/supabase-js";
import { readSentRfcMessageId } from "@/lib/gmail";
import { scopeForGameId } from "@/lib/inbox-scope";

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data: rows, error } = await supabase
    .from("inquiry_messages")
    .select("id, gmail_message_id, rfc_message_id, inquiry:inquiries(game_id)")
    .eq("direction", "outbound")
    .not("gmail_message_id", "is", null)
    .order("sent_at");
  if (error || !rows) {
    console.error("보낸 답변 목록을 읽지 못했습니다:", error?.message);
    process.exit(1);
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows as Array<{
    id: string;
    gmail_message_id: string;
    rfc_message_id: string | null;
    inquiry: { game_id: string | null } | { game_id: string | null }[] | null;
  }>) {
    if (row.rfc_message_id?.endsWith("@mail.gmail.com>")) {
      skipped += 1;
      continue;
    }
    const inquiry = Array.isArray(row.inquiry) ? row.inquiry[0] : row.inquiry;
    const mailbox = scopeForGameId(inquiry?.game_id ?? null).kind;
    try {
      const actual = await readSentRfcMessageId(mailbox, row.gmail_message_id);
      if (!actual || actual === row.rfc_message_id) {
        skipped += 1;
        continue;
      }
      const { error: updateError } = await supabase
        .from("inquiry_messages")
        .update({ rfc_message_id: actual })
        .eq("id", row.id);
      if (updateError) throw new Error(updateError.message);
      updated += 1;
      console.log(`${row.id}: ${row.rfc_message_id} → ${actual}`);
    } catch (readError) {
      failed += 1;
      console.warn(`${row.id}: 실패 (${mailbox})`, readError instanceof Error ? readError.message : readError);
    }
  }
  console.log(`갱신 ${updated}건, 건너뜀 ${skipped}건, 실패 ${failed}건 (전체 ${rows.length}건)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
