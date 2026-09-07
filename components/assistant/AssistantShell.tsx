"use client";

import { useState } from "react";
import type { ConversationRow } from "@/lib/assistant-store";
import type { SourceRow } from "@/lib/assistant-sources";
import ConversationSidebar from "@/components/assistant/ConversationSidebar";
import ChatPane from "@/components/assistant/ChatPane";
import SourceAddDialog from "@/components/assistant/SourceAddDialog";
import type { ChatMessage } from "@/components/assistant/messages";

export default function AssistantShell({
  game,
  sources,
  conversations,
  selectedId,
  messages,
  serviceAccountEmail,
}: {
  game: { id: string; name: string };
  sources: SourceRow[];
  conversations: ConversationRow[];
  selectedId: string | null;
  messages: ChatMessage[];
  serviceAccountEmail: string | null;
}) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="h-screen flex bg-ground">
      <ConversationSidebar gameId={game.id} gameName={game.name} conversations={conversations} selectedId={selectedId} sources={sources} onAddSource={() => setAddOpen(true)} />

      {sources.length > 0 ? (
        <ChatPane key={selectedId ?? "new"} gameId={game.id} conversationId={selectedId} initialMessages={messages} />
      ) : (
        <section className="flex-1 flex items-center justify-center" aria-label="대화">
          <div className="text-center flex flex-col items-center gap-3">
            <p className="text-sm text-muted">이 게임에 연결된 자료가 없습니다.</p>
            <button type="button" onClick={() => setAddOpen(true)} className="rounded-lg bg-accent text-white px-4 py-2 text-sm font-medium hover:opacity-90">
              자료 추가하기
            </button>
          </div>
        </section>
      )}

      {addOpen && <SourceAddDialog gameId={game.id} serviceAccountEmail={serviceAccountEmail} onClose={() => setAddOpen(false)} />}
    </div>
  );
}
