"use client";

import { useRef, useState } from "react";
import type { ConversationRow } from "@/lib/assistant-store";
import ConversationSidebar from "@/components/assistant/ConversationSidebar";
import ChatPane from "@/components/assistant/ChatPane";
import SheetSettingsDialog from "@/components/assistant/SheetSettingsDialog";
import type { ChatMessage } from "@/components/assistant/messages";

export default function AssistantShell({
  game,
  conversations,
  selectedId,
  messages,
  serviceAccountEmail,
}: {
  game: { id: string; name: string; sheetId: string | null };
  conversations: ConversationRow[];
  selectedId: string | null;
  messages: ChatMessage[];
  serviceAccountEmail: string | null;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ChatPane's key controls when React remounts it. A null → id transition happens the moment
  // the first message of a new conversation creates it (ChatPane.ensureConversation) and the
  // URL is updated in place via history.replaceState — the pane must survive that render so the
  // in-flight stream isn't lost. A later switch to a *different, already-established*
  // conversation (sidebar click) should still remount it so the new conversation's
  // initialMessages take effect. So: track the previous selectedId, and only adopt a new,
  // non-null selectedId into the pane key when the previous one was also non-null (a real
  // conversation-to-conversation switch); a transition out of "new chat" (previous was null)
  // keeps the key unchanged.
  const prevSelectedIdRef = useRef<string | null>(selectedId);
  const paneKeyRef = useRef<string>(selectedId ?? "new");
  if (selectedId === null) {
    paneKeyRef.current = "new";
  } else if (prevSelectedIdRef.current !== null && prevSelectedIdRef.current !== selectedId) {
    paneKeyRef.current = selectedId;
  }
  prevSelectedIdRef.current = selectedId;
  const paneKey = paneKeyRef.current;

  return (
    <div className="h-screen flex bg-ground">
      <ConversationSidebar gameId={game.id} gameName={game.name} conversations={conversations} selectedId={selectedId} onOpenSettings={() => setSettingsOpen(true)} />

      {game.sheetId ? (
        <ChatPane key={paneKey} gameId={game.id} conversationId={selectedId} initialMessages={messages} />
      ) : (
        <section className="flex-1 flex items-center justify-center" aria-label="대화">
          <div className="text-center flex flex-col items-center gap-3">
            <p className="text-sm text-muted">이 게임에 연결된 운영 시트가 없습니다.</p>
            <button type="button" onClick={() => setSettingsOpen(true)} className="rounded-lg bg-accent text-white px-4 py-2 text-sm font-medium hover:opacity-90">
              시트 연결하기
            </button>
          </div>
        </section>
      )}

      {settingsOpen && (
        <SheetSettingsDialog gameId={game.id} currentSheetId={game.sheetId} serviceAccountEmail={serviceAccountEmail} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}
