/**
 * 1회성 유틸: 이미 있는 게임마다 유형별 "답변 본보기" 템플릿(lib/default-templates.ts의
 * DEFAULT_RESOLUTION_TEMPLATES)을 자동 발송 꺼진 상태로 넣는다. 새 게임은 생성 시
 * 자동으로 받으므로 이 스크립트는 기존 게임용이다. 같은 제목이 있으면 건너뛴다.
 *
 * 사용법: .env.local에 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY를 채워둔 뒤
 *   set -a && source .env.local && set +a && npx vite-node --config vitest.config.ts scripts/seed-resolution-templates.ts
 */
import { createClient } from "@supabase/supabase-js";
import { seedResolutionTemplatesForGame } from "@/lib/default-templates";

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data: games, error } = await supabase.from("games").select("id, name").order("created_at");
  if (error || !games) {
    console.error("게임 목록을 읽지 못했습니다:", error?.message);
    process.exit(1);
  }

  for (const game of games) {
    const added = await seedResolutionTemplatesForGame(supabase, game.id);
    console.log(`${game.name}: ${added}건 추가`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
