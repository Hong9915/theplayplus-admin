/**
 * 1회성 유틸: 사용자 회신에 사진으로 잘못 저장된 우리 메일 헤더 로고를 지운다.
 * 사용자가 답장하면 메일 앱이 인용한 우리 답변의 로고(cid 인라인 PNG)를 회신에 다시 붙여
 * 보내는데, 예전 회신 동기화는 그것도 회신 사진으로 저장했다. 이제는 lib/gmail.ts의
 * extractImageAttachments가 거른다.
 *
 * 대상: inbound 메시지에 묶인 첨부 중 파일 이름이 theplayplus-logo.png이거나, 내려받은
 * PNG 바이트가 우리 로고와 똑같은 것(이름을 바꿔 붙이는 메일 앱 대비). 사용자가 보낸 다른
 * 사진은 건드리지 않는다.
 *
 * 사용법: .env.local에 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY를 채워둔 뒤
 *   npx vite-node --config vitest.config.ts scripts/remove-quoted-logo-attachments.ts          # 확인만
 *   npx vite-node --config vitest.config.ts scripts/remove-quoted-logo-attachments.ts --apply  # 실제 삭제
 * 행을 먼저 지우고 버킷 파일을 치운다. 다시 실행하면 남은 것만 처리한다.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { ATTACHMENT_BUCKET } from "@/lib/attachment-rules";
import { EMAIL_LOGO_FILENAME, getEmailLogo } from "@/lib/email-logo";

/** source .env.local은 JSON 값이 든 줄을 깨뜨리므로 한 줄씩 읽는다. */
function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}

interface AttachmentRow {
  id: string;
  inquiry_id: string;
  file_path: string;
  file_name: string | null;
  message: { direction: string } | null;
}

async function main() {
  loadEnvLocal();
  const apply = process.argv.includes("--apply");
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.");
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const logo = getEmailLogo();

  const { data, error } = await supabase
    .from("inquiry_attachments")
    .select("id, inquiry_id, file_path, file_name, message:inquiry_messages(direction)")
    .not("message_id", "is", null);
  if (error || !data) {
    console.error("메시지 첨부 목록을 읽지 못했습니다:", error?.message);
    process.exit(1);
  }
  const rows = (data as unknown as AttachmentRow[]).filter((row) => row.message?.direction === "inbound");

  const targets: AttachmentRow[] = [];
  for (const row of rows) {
    if (row.file_name === EMAIL_LOGO_FILENAME) {
      targets.push(row);
      continue;
    }
    if (!/\.png$/i.test(row.file_path)) continue;
    const { data: blob, error: downloadError } = await supabase.storage.from(ATTACHMENT_BUCKET).download(row.file_path);
    if (downloadError || !blob) {
      console.warn("내려받기 실패(건너뜀):", row.file_path, downloadError?.message);
      continue;
    }
    if (Buffer.from(await blob.arrayBuffer()).equals(logo)) targets.push(row);
  }

  console.log(`회신 첨부 ${rows.length}건 중 로고 ${targets.length}건`);
  for (const row of targets) console.log(`  문의 ${row.inquiry_id}  ${row.file_name ?? ""}  ${row.file_path}`);
  if (targets.length === 0) return;
  if (!apply) {
    console.log("\n확인만 했습니다. 지우려면 --apply를 붙여 다시 실행하세요.");
    return;
  }

  const { error: deleteError } = await supabase
    .from("inquiry_attachments")
    .delete()
    .in("id", targets.map((row) => row.id));
  if (deleteError) {
    console.error("첨부 행 삭제 실패:", deleteError.message);
    process.exit(1);
  }
  const { error: removeError } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .remove(targets.map((row) => row.file_path));
  if (removeError) console.warn("행은 지웠지만 버킷 파일 정리 실패:", removeError.message);
  console.log(`첨부 행 ${targets.length}건${removeError ? "" : "과 버킷 파일"}을 지웠습니다.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
