"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { readNdjson } from "@/lib/ndjson";
import type { Proposal } from "@/lib/sheets";
import ProposalCard from "@/components/assistant/ProposalCard";
import { GENERIC_ERROR, STREAM_ERROR_MESSAGES, type ChatMessage } from "@/components/assistant/messages";

type StreamEvent =
  | { type: "text"; text: string }
  | { type: "proposal"; messageId: string; proposal: Proposal }
  | { type: "error"; reason: string };

function isStreamEvent(value: unknown): value is StreamEvent {
  return typeof value === "object" && value !== null && "type" in value;
}

function textMessage(id: string, role: "user" | "assistant", content: string): ChatMessage {
  return { id, role, content, proposal: null, status: null, failureReason: null, appliedBy: null, appliedAt: null };
}

/**
 * 대화 영역. 메시지 목록을 state로 들고, 전송하면 NDJSON 스트림을 읽어 어시스턴트
 * 본문을 조각마다 갱신한다. 대화가 없으면 첫 전송 때 만든다.
 */
export default function ChatPane({
  gameId,
  conversationId,
  initialMessages,
}: {
  gameId: string;
  conversationId: string | null;
  initialMessages: ChatMessage[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages]);

  function patchMessage(id: string, patch: Partial<ChatMessage>) {
    setMessages((current) => current.map((message) => (message.id === id ? { ...message, ...patch } : message)));
  }

  async function ensureConversation(firstMessage: string): Promise<string | null> {
    if (conversationId) return conversationId;
    const response = await fetch("/api/assistant/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameId, firstMessage }),
    });
    const json = (await response.json()) as { success: boolean; conversationId?: string };
    if (!json.success || !json.conversationId) return null;
    // router.replace soft-navigates on Next 14.2 and re-renders this page with the new
    // selectedId, which (if the pane's key changed) unmounts it mid-stream. history.replaceState
    // updates the URL/back-stack the same way without triggering that re-render; Next >=14.1
    // keeps its router in sync with it.
    window.history.replaceState(null, "", `/games/${gameId}/assistant?c=${json.conversationId}`);
    return json.conversationId;
  }

  async function send() {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    setDraft("");

    const localUserId = `local-user-${Date.now()}`;
    const localAssistantId = `local-assistant-${Date.now()}`;
    setStreamingId(localAssistantId);
    setMessages((current) => [...current, textMessage(localUserId, "user", content)]);

    let failure: string | null = null;
    let text = "";

    try {
      const id = await ensureConversation(content);
      if (!id) {
        failure = "save_failed";
      } else {
        const response = await fetch(`/api/assistant/conversations/${id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });

        if (!response.ok || !response.body) {
          const json = (await response.json()) as { error?: string };
          failure = json.error ?? "failed";
        } else {
          for await (const event of readNdjson(response.body)) {
            if (!isStreamEvent(event)) continue;
            if (event.type === "text") {
              text += event.text;
              const snapshot = text;
              setMessages((current) => {
                const exists = current.some((message) => message.id === localAssistantId);
                return exists
                  ? current.map((message) => (message.id === localAssistantId ? { ...message, content: snapshot } : message))
                  : [...current, textMessage(localAssistantId, "assistant", snapshot)];
              });
            } else if (event.type === "proposal") {
              setMessages((current) => [
                ...current,
                { id: event.messageId, role: "proposal", content: "", proposal: event.proposal, status: "pending", failureReason: null, appliedBy: null, appliedAt: null },
              ]);
            } else {
              failure = event.reason;
            }
          }
        }
      }
    } catch {
      failure = "failed";
    }

    setSending(false);
    setStreamingId(null);
    if (failure) {
      setError(STREAM_ERROR_MESSAGES[failure] ?? GENERIC_ERROR);
    }
    // 사이드바의 대화 제목·순서는 서버가 안다.
    router.refresh();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void send();
    }
  }

  return (
    <section className="flex-1 min-w-0 h-full flex flex-col" aria-label="대화">
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-4">
          {messages.length === 0 && (
            <p className="text-center text-muted text-sm py-16">시트에 대해 물어보거나 수정을 요청하세요. 예: “52009 VIP 몇이야”, “52009 VIP4로 올려줘”</p>
          )}
          {messages.map((message) => {
            if (message.role === "user") {
              return (
                <div key={message.id} className="self-end max-w-[80%] rounded-2xl rounded-br-md bg-accent text-white px-4 py-2.5 text-sm whitespace-pre-wrap">
                  {message.content}
                </div>
              );
            }
            if (message.role === "proposal") {
              return (
                <div key={message.id} className="self-start w-full max-w-[90%]">
                  <ProposalCard message={message} onChange={(patch) => patchMessage(message.id, patch)} />
                </div>
              );
            }
            return (
              <div key={message.id} className="self-start max-w-[90%] text-sm leading-relaxed whitespace-pre-wrap">
                {message.content}
                {message.id === streamingId && <span className="inline-block w-2 h-4 ml-0.5 bg-ink/60 animate-pulse align-text-bottom" aria-hidden="true" />}
              </div>
            );
          })}
          {error && <p className="text-red-600 text-sm" role="alert">{error}</p>}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-line bg-panel px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-end gap-2">
          <textarea
            aria-label="메시지"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            disabled={sending}
            rows={2}
            placeholder="메시지를 입력하세요 (Cmd/Ctrl+Enter 전송)"
            className="flex-1 resize-none rounded-xl border border-line bg-panel px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending || !draft.trim()}
            className="rounded-xl bg-accent text-white px-4 py-3 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {sending ? "전송 중…" : "보내기"}
          </button>
        </div>
      </div>
    </section>
  );
}
