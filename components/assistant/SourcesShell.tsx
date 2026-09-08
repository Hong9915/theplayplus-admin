"use client";

import { useState } from "react";
import type { SourceRow } from "@/lib/source-url";
import SourceList from "@/components/assistant/SourceList";
import SourceAddDialog from "@/components/assistant/SourceAddDialog";

/**
 * 운영 자료 관리 화면. 어시스턴트 채팅이 꺼져 있을 때 /games/{id}/assistant가 이걸 그린다.
 * 연결한 시트·문서는 AI 답변 추천이 근거로 읽는다.
 */
export default function SourcesShell({
  game,
  sources,
  serviceAccountEmail,
}: {
  game: { id: string; name: string };
  sources: SourceRow[];
  serviceAccountEmail: string | null;
}) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <main className="min-h-screen bg-ground flex justify-center px-4 py-10">
      <div className="w-full max-w-[560px] flex flex-col gap-5">
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-bold truncate">{game.name}</h1>
          <span className="text-xs text-muted shrink-0">운영 자료</span>
        </div>
        <p className="text-sm text-muted">
          여기에 연결한 구글 스프레드시트·문서는 문의함의 &quot;AI 답변 추천&quot;이 답변 근거로 읽습니다.
          {serviceAccountEmail && (
            <>
              {" "}
              각 자료를 <span className="font-mono text-ink break-all">{serviceAccountEmail}</span>에 편집자로 공유한 뒤 추가하세요.
            </>
          )}
        </p>
        <section className="bg-panel border border-line rounded-xl p-3">
          <SourceList gameId={game.id} sources={sources} onAddSource={() => setAddOpen(true)} size="md" />
        </section>
      </div>
      {addOpen && <SourceAddDialog gameId={game.id} serviceAccountEmail={serviceAccountEmail} onClose={() => setAddOpen(false)} />}
    </main>
  );
}
