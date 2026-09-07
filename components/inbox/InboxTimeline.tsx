import type { TimelineEntry } from "@/lib/timeline";
import type { AttachmentWithUrl } from "@/lib/inquiries";
import type { CategoryLabelMaps } from "@/lib/categories";
import { emailLocalPart, formatReceivedAt } from "@/lib/format";
import StatusBadge from "@/components/ui/StatusBadge";
import ScrollToCurrent from "@/components/inbox/ScrollToCurrent";
import TranslatableBody from "@/components/inbox/TranslatableBody";

type MessageEntry = Exclude<TimelineEntry, { kind: "divider" }>;
type DividerEntry = Extract<TimelineEntry, { kind: "divider" }>;

const LABEL: Record<MessageEntry["kind"], string> = {
  inquiry: "문의 접수",
  inbound: "이메일 회신",
  outbound: "이메일 발송",
  note: "내부 메모",
};

function labelText(entry: MessageEntry): string {
  // 자동 답변은 관리자가 직접 보낸 것과 구분해야 이미 답한 것으로 착각하지 않는다.
  if (entry.kind === "outbound" && entry.auto) return "자동 발송";
  return LABEL[entry.kind];
}

function authorText(entry: MessageEntry): string {
  switch (entry.kind) {
    case "inquiry":
    case "inbound":
      return entry.author ?? "사용자";
    case "outbound":
      if (entry.auto) return "THE PLAY+ 자동 답변";
      return entry.author ? emailLocalPart(entry.author) : "THE PLAY+ 고객지원";
    case "note":
      return emailLocalPart(entry.author);
  }
}

function Avatar({ entry }: { entry: MessageEntry }) {
  if (entry.kind === "outbound") {
    return <div className="w-8 h-8 rounded-full bg-ink text-white flex items-center justify-center text-[11px] font-bold shrink-0">P+</div>;
  }
  if (entry.kind === "note") {
    return (
      <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
        </svg>
      </div>
    );
  }
  const initial = (entry.author ?? "?").charAt(0).toUpperCase();
  return <div className="w-8 h-8 rounded-full bg-accent/10 text-accent flex items-center justify-center text-xs font-bold shrink-0">{initial}</div>;
}

function Attachments({ attachments }: { attachments: AttachmentWithUrl[] }) {
  if (attachments.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2 text-xs">
      {attachments.map((attachment) => (
        <li key={attachment.id} className="flex flex-col gap-1 max-w-[240px]">
          {attachment.signedUrl ? (
            <>
              <a href={attachment.signedUrl} target="_blank" rel="noreferrer" title="원본 크기로 열기" className="block border border-line rounded-lg overflow-hidden bg-black/5">
                {/* 첨부 버킷은 이미지 MIME만 허용하므로 항상 <img>로 렌더링한다. */}
                <img src={attachment.signedUrl} alt={attachment.fileName} loading="lazy" width={240} height={192} className="max-h-48 w-auto max-w-full object-contain" />
              </a>
              <span className="text-muted truncate">{attachment.fileName}</span>
            </>
          ) : (
            <span className="text-muted">{attachment.fileName} (링크 생성 실패)</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** 같은 계정의 다른 문의가 시작되는 지점. 선택한 문의는 accent로 강조한다. */
function Divider({ entry, labels }: { entry: DividerEntry; labels: CategoryLabelMaps }) {
  return (
    <li
      data-kind="divider"
      data-current={entry.current ? "true" : "false"}
      className={`flex items-center gap-3 pt-2 ${entry.current ? "scroll-mt-4" : ""}`}
    >
      <span className={`flex-1 border-t ${entry.current ? "border-accent/40" : "border-line"}`} aria-hidden="true" />
      <div
        className={`flex items-center gap-2 max-w-full rounded-full border px-3 py-1 text-xs bg-panel ${
          entry.current ? "border-accent text-ink" : "border-line text-muted"
        }`}
      >
        <span className="font-mono text-[11px]">{entry.inquiryNo ?? "—"}</span>
        <span className={`truncate ${entry.current ? "font-semibold" : "font-medium"}`}>{entry.title}</span>
        <span className="shrink-0">{labels.typeLabels[entry.typeKey] ?? entry.typeKey}</span>
        <StatusBadge status={entry.status} />
        <span className="font-mono text-[11px] shrink-0">{formatReceivedAt(entry.at)}</span>
      </div>
      <span className={`flex-1 border-t ${entry.current ? "border-accent/40" : "border-line"}`} aria-hidden="true" />
    </li>
  );
}

/**
 * 문의 본문·답변·회신·메모를 시간순 말풍선으로. 데이터 순서는 lib/timeline이 정한다.
 * 같은 계정의 문의가 여러 건이면 문의마다 구분선이 들어오고, 선택한 문의로 자동 스크롤한다.
 */
export default function InboxTimeline({ entries, labels }: { entries: TimelineEntry[]; labels: CategoryLabelMaps }) {
  const hasDividers = entries.some((entry) => entry.kind === "divider");
  return (
    <ol className="flex flex-col gap-4">
      {hasDividers && <ScrollToCurrent />}
      {entries.map((entry) => {
        if (entry.kind === "divider") {
          return <Divider key={`divider-${entry.id}`} entry={entry} labels={labels} />;
        }
        const outbound = entry.kind === "outbound";
        const note = entry.kind === "note";
        return (
          <li key={`${entry.kind}-${entry.id}`} className={`flex gap-3 items-start ${outbound ? "flex-row-reverse" : ""}`} data-kind={entry.kind}>
            <Avatar entry={entry} />
            <div className={`flex flex-col gap-1.5 max-w-[640px] min-w-0 ${outbound ? "items-end" : ""}`}>
              <div className="flex items-baseline gap-2 text-xs">
                <span className={`font-semibold ${note ? "text-amber-700" : outbound ? "text-ink" : "text-accent"}`}>{authorText(entry)}</span>
                <span className="text-muted">{labelText(entry)}</span>
                <span className="text-muted font-mono">{formatReceivedAt(entry.at)}</span>
              </div>
              <div
                className={`rounded-xl border px-3.5 py-3 text-sm leading-relaxed ${
                  note ? "bg-amber-50 border-amber-200 text-amber-900" : "bg-panel border-line"
                }`}
              >
                {/* 메모는 관리자가 한국어로 쓰니 번역 메뉴가 필요 없다. 나머지는 우클릭으로 번역. */}
                {note ? (
                  <p className="whitespace-pre-wrap break-words">{entry.body}</p>
                ) : (
                  <TranslatableBody
                    inquiryId={entry.kind === "inquiry" ? entry.id : entry.inquiryId}
                    target={entry.kind === "inquiry" ? { kind: "inquiry" } : { kind: "message", messageId: entry.id }}
                    body={entry.body}
                    translations={entry.translations}
                  />
                )}
                {entry.kind === "inquiry" && entry.details.length > 0 && (
                  <dl className="mt-2.5 pt-2.5 border-t border-line flex flex-col gap-1 text-xs" data-testid="inquiry-details">
                    {entry.details.map((row) => (
                      <div key={row.key} className="flex gap-2">
                        <dt className="text-muted shrink-0 w-16">{row.label}</dt>
                        <dd className="break-all">{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
              {entry.kind === "inquiry" && <Attachments attachments={entry.attachments} />}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
