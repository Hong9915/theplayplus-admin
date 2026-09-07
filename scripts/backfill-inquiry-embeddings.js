/**
 * 1회성 유틸: 이미 답변이 붙은 문의의 임베딩을 채운다(AI 답변 추천의 유사 문의 검색용).
 *
 * 사용법: .env.local에 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY를 채워둔 뒤
 *   node scripts/backfill-inquiry-embeddings.js
 *
 * 대상은 reply_content가 있고 임베딩이 없거나 다른 모델로 만든 문의다. 100건씩
 * 읽어 embeddings API에 한 번에 보내고 행마다 저장한다. 실패한 문의는 id를 stderr에
 * 남기고 계속 진행하며, 다시 실행하면 남은 것만 처리한다.
 *
 * lib/embeddings.ts를 import하지 않는다(TS·경로 별칭). 텍스트 규칙(제목+빈 줄+본문,
 * 8000자)은 그 파일과 같아야 하며 tests/scripts/backfill-embeddings.test.ts가 확인한다.
 */
const fs = require("fs");
const path = require("path");

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const EMBEDDING_MAX_CHARS = 8000;
const PAGE_SIZE = 100;

function embeddingText(title, content) {
  const text = `${String(title).trim()}\n\n${String(content).trim()}`;
  return text.length > EMBEDDING_MAX_CHARS ? text.slice(0, EMBEDDING_MAX_CHARS) : text;
}

function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (!process.env[key]) process.env[key] = value.trim();
  }
}

async function fetchPage(supabase) {
  const { data, error } = await supabase
    .from("inquiries")
    .select("id, title, content")
    .not("reply_content", "is", null)
    .or(`embedding.is.null,embedding_model.neq.${EMBEDDING_MODEL}`)
    .order("created_at", { ascending: true })
    .limit(PAGE_SIZE);
  if (error) throw new Error(`inquiries 조회 실패: ${error.message}`);
  return data ?? [];
}

async function main() {
  loadEnvLocal();

  const { createClient } = require("@supabase/supabase-js");
  const OpenAI = require("openai").default;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!url || !key || !apiKey) {
    console.error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY가 필요합니다.");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const openai = new OpenAI({ apiKey });

  let done = 0;
  const failed = [];

  while (true) {
    const rows = await fetchPage(supabase);
    // 저장에 실패한 행은 다음 페이지에도 다시 나온다. 전부 실패면 멈춘다.
    const pending = rows.filter((row) => !failed.includes(row.id));
    if (pending.length === 0) break;

    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: pending.map((row) => embeddingText(row.title ?? "", row.content ?? "")),
      dimensions: EMBEDDING_DIMENSIONS,
    });

    for (const item of response.data) {
      const row = pending[item.index];
      const { error } = await supabase
        .from("inquiries")
        .update({ embedding: item.embedding, embedding_model: EMBEDDING_MODEL })
        .eq("id", row.id);
      if (error) {
        failed.push(row.id);
        console.error(`저장 실패 ${row.id}: ${error.message}`);
      } else {
        done += 1;
      }
    }

    console.log(`처리 ${done}건, 실패 ${failed.length}건`);
  }

  console.log(`완료: ${done}건 저장, ${failed.length}건 실패`);
  if (failed.length > 0) {
    console.error(`실패한 문의 id:\n${failed.join("\n")}`);
    process.exit(1);
  }
}

module.exports = { embeddingText, EMBEDDING_MAX_CHARS, EMBEDDING_MODEL };

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
