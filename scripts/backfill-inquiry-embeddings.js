/**
 * 1회성 유틸: 이미 답변이 붙은 문의의 임베딩을 채운다(AI 답변 추천의 유사 문의 검색용).
 *
 * 사용법: .env.local에 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY를 채워둔 뒤
 *   node scripts/backfill-inquiry-embeddings.js
 *
 * 대상은 reply_content가 있고 임베딩이 없거나 다른 모델로 만든 문의다. 50건씩
 * 읽어 embeddings API에 한 번에 보내고 행마다 저장한다. 페이지 전체가 실패해도(요청 자체가
 * 거부되는 등) 그 페이지의 모든 id를 실패로 기록하고 커서를 넘겨 계속 진행하며, 다시
 * 실행하면 남은 것만 처리한다. 키셋 커서를 써 페이지를 넘기므로 실패한 행이 진행을 막지 않는다.
 *
 * lib/embeddings.ts를 import하지 않는다(TS·경로 별칭). 텍스트 규칙(제목+빈 줄+본문,
 * 4000자)은 그 파일과 같아야 하며 tests/scripts/backfill-embeddings.test.ts가 확인한다.
 */
const fs = require("fs");
const path = require("path");

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
// 한국어는 글자당 1토큰 가까이 쓰므로 8191토큰 상한의 절반 아래로 둔다.
const EMBEDDING_MAX_CHARS = 4000;
// 한 요청의 토큰 합계 상한(약 30만) 아래에 머물도록 페이지를 작게 둔다.
const PAGE_SIZE = 50;

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

async function fetchPage(supabase, cursor) {
  let query = supabase
    .from("inquiries")
    .select("id, title, content, created_at")
    .not("reply_content", "is", null)
    .or(`embedding.is.null,embedding_model.neq.${EMBEDDING_MODEL}`)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(PAGE_SIZE);
  // 키셋 커서: 마지막으로 본 (created_at, id) 뒤부터. 실패한 행이 앞을 막지 않는다.
  // PostgREST는 같은 쿼리에 or()를 여러 번 걸면 AND로 묶으므로, 검색 조건과 커서
  // 조건이 둘 다 살아남는다.
  if (cursor) {
    query = query.or(`created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`);
  }
  const { data, error } = await query;
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
  let cursor = null;

  while (true) {
    const rows = await fetchPage(supabase, cursor);
    if (rows.length === 0) break;

    let response;
    try {
      response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: rows.map((row) => embeddingText(row.title ?? "", row.content ?? "")),
        dimensions: EMBEDDING_DIMENSIONS,
      });
    } catch (error) {
      // 이 페이지 전체가 거부/실패해도 커서는 넘긴다 — 한 페이지가 전체 진행을 막으면 안 된다.
      console.error(`임베딩 실패 (페이지 ${rows.length}건): ${error.message}`);
      for (const row of rows) failed.push(row.id);
      cursor = { createdAt: rows[rows.length - 1].created_at, id: rows[rows.length - 1].id };
      console.log(`처리 ${done}건, 실패 ${failed.length}건`);
      continue;
    }

    for (const item of response.data) {
      const row = rows[item.index];
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

    cursor = { createdAt: rows[rows.length - 1].created_at, id: rows[rows.length - 1].id };
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
