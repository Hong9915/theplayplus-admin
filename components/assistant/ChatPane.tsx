"use client";

import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { readNdjson } from "@/lib/ndjson";
import type { Proposal } from "@/lib/sheets";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES,
  MAX_MESSAGE_ATTACHMENT_BYTES,
  SUPPORTED_ATTACHMENT_ACCEPT,
  isSupportedAttachment,
} from "@/lib/attachment-rules";
import ProposalCard from "@/components/assistant/ProposalCard";
import { GENERIC_ERROR, STREAM_ERROR_MESSAGES, formatFileSize, type ChatAttachment, type ChatMessage } from "@/components/assistant/messages";

type StreamEvent =
  | { type: "text"; text: string }
  | { type: "proposal"; messageId: string; proposal: Proposal }
  | { type: "error"; reason: string };

function isStreamEvent(value: unknown): value is StreamEvent {
  return typeof value === "object" && value !== null && "type" in value;
}

function textMessage(id: string, role: "user" | "assistant", content: string, attachments: ChatAttachment[] = []): ChatMessage {
  return { id, role, content, proposal: null, status: null, failureReason: null, appliedBy: null, appliedAt: null, attachments };
}

function AttachmentChips({ attachments, onRemove }: { attachments: ChatAttachment[]; onRemove?: (index: number) => void }) {
  if (attachments.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="첨부 파일">
      {attachments.map((attachment, index) => (
        <li key={`${attachment.name}-${index}`} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel/80 px-2.5 py-1 text-xs text-ink">
          <span aria-hidden="true">📄</span>
          <span className="max-w-[16rem] truncate">{attachment.name}</span>
          <span className="text-muted">{formatFileSize(attachment.size)}</span>
          {onRemove && (
            <button type="button" onClick={() => onRemove(index)} aria-label={`${attachment.name} 제거`} className="ml-0.5 text-muted hover:text-ink">
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
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
  const [files, setFiles] = useState<File[]>([]);
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

  function pickFiles(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    setError(null);
    for (const file of picked) {
      if (!isSupportedAttachment(file.name)) {
        setError(STREAM_ERROR_MESSAGES.unsupported_type);
        return;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setError(STREAM_ERROR_MESSAGES.file_too_large);
        return;
      }
    }
    setFiles((current) => {
      const next = [...current, ...picked];
      if (next.length > MAX_ATTACHMENTS_PER_MESSAGE) {
        setError(STREAM_ERROR_MESSAGES.too_many_files);
        return current;
      }
      if (next.reduce((sum, file) => sum + file.size, 0) > MAX_MESSAGE_ATTACHMENT_BYTES) {
        setError(STREAM_ERROR_MESSAGES.message_too_large);
        return current;
      }
      return next;
    });
  }

  /** 파일이 있으면 multipart, 없으면 JSON. 서버는 둘 다 받는다. */
  function buildRequest(content: string, attached: File[]): RequestInit {
    if (attached.length === 0) {
      return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) };
    }
    const form = new FormData();
    form.set("content", content);
    for (const file of attached) form.append("files", file);
    return { method: "POST", body: form };
  }

  async function send() {
    const content = draft.trim();
    const attached = files;
    if ((!content && attached.length === 0) || sending) return;
    setSending(true);
    setError(null);
    setDraft("");
    setFiles([]);

    const localUserId = `local-user-${Date.now()}`;
    const localAssistantId = `local-assistant-${Date.now()}`;
    setStreamingId(localAssistantId);
    setMessages((current) => [
      ...current,
      textMessage(localUserId, "user", content, attached.map((file) => ({ name: file.name, size: file.size }))),
    ]);

    let failure: string | null = null;
    let text = "";

    try {
      const id = await ensureConversation(content || attached[0]?.name || "");
      if (!id) {
        failure = "save_failed";
      } else {
        const response = await fetch(`/api/assistant/conversations/${id}/messages`, buildRequest(content, attached));

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
                { id: event.messageId, role: "proposal", content: "", proposal: event.proposal, status: "pending", failureReason: null, appliedBy: null, appliedAt: null, attachments: [] },
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
                <div key={message.id} className="self-end max-w-[80%] flex flex-col items-end gap-1.5">
                  {message.content && (
                    <div className="rounded-2xl rounded-br-md bg-accent text-white px-4 py-2.5 text-sm whitespace-pre-wrap">{message.content}</div>
                  )}
                  <AttachmentChips attachments={message.attachments} />
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
        <div className="max-w-3xl mx-auto flex flex-col gap-2">
          <AttachmentChips attachments={files.map((file) => ({ name: file.name, size: file.size }))} onRemove={(index) => setFiles((current) => current.filter((_, i) => i !== index))} />
          <div className="flex items-end gap-2">
          <label
            className={`shrink-0 cursor-pointer rounded-xl border border-line px-3 py-3 text-sm text-muted hover:text-ink hover:bg-ground ${sending ? "pointer-events-none opacity-50" : ""}`}
            title="파일 첨부 (txt, md, csv, tsv, json, xlsx · 파일당 4MB · 합계 4MB · 5개까지)"
          >
            <span aria-hidden="true">📎</span>
            <input type="file" aria-label="파일 첨부" multiple accept={SUPPORTED_ATTACHMENT_ACCEPT} onChange={pickFiles} disabled={sending} className="sr-only" />
          </label>
          <textarea
            aria-label="메시지"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            disabled={sending}
            rows={2}
            placeholder={files.length > 0 ? "파일에 대해 물어보세요 (비워도 보낼 수 있음)" : "메시지를 입력하세요 (Cmd/Ctrl+Enter 전송)"}
            className="flex-1 resize-none rounded-xl border border-line bg-panel px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending || (!draft.trim() && files.length === 0)}
            className="rounded-xl bg-accent text-white px-4 py-3 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {sending ? "전송 중…" : "보내기"}
          </button>
          </div>
        </div>
      </div>
    </section>
  );
}
