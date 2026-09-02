import type { MessageRow } from "@/lib/messages";
import { emailLocalPart, formatReceivedAt } from "@/lib/format";
import SyncRepliesButton from "@/components/inquiries/SyncRepliesButton";

/**
 * 문의 하나에 오간 답변과 회신을 시간순으로 보여준다. 답변이 하나도 없으면
 * 카드 자체를 그리지 않는다 — 문의 내용 아래 빈 카드는 소음이다.
 */
export default function InquiryThread({
  inquiryId,
  messages,
  hasGmailThread,
}: {
  inquiryId: string;
  messages: MessageRow[];
  hasGmailThread: boolean;
}) {
  if (messages.length === 0) {
    return null;
  }

  return (
    <section className="bg-panel border border-line rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="font-semibold">
          대화 <span className="ml-1 text-sm font-normal text-muted">{messages.length}건</span>
        </h2>
        {hasGmailThread && <SyncRepliesButton inquiryId={inquiryId} />}
      </div>
      <ol className="flex flex-col gap-3">
        {messages.map((message) => {
          const outbound = message.direction === "outbound";
          return (
            <li
              key={message.id}
              className={`rounded-xl border px-3 py-2.5 ${
                outbound ? "border-line bg-ground/60" : "border-accent/30 bg-accent/5"
              }`}
              data-direction={message.direction}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-1.5 text-xs text-muted">
                <span className={`font-medium ${outbound ? "text-ink" : "text-accent"}`}>
                  {outbound ? "보낸 답변" : "사용자 회신"}
                  {message.authorEmail && (
                    <span className="ml-1.5 font-normal text-muted" title={message.authorEmail}>
                      {outbound ? emailLocalPart(message.authorEmail) : message.authorEmail}
                    </span>
                  )}
                </span>
                <span className="font-mono">{formatReceivedAt(message.sentAt)}</span>
              </div>
              <p className="whitespace-pre-wrap text-sm">{message.body}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
