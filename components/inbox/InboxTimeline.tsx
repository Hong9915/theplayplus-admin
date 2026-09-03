import type { TimelineEntry } from "@/lib/timeline";
import type { AttachmentWithUrl } from "@/lib/inquiries";
import { emailLocalPart, formatReceivedAt } from "@/lib/format";

const LABEL: Record<TimelineEntry["kind"], string> = {
  inquiry: "문의 접수",
  inbound: "이메일 회신",
  outbound: "이메일 발송",
  note: "내부 메모",
};

function labelText(entry: TimelineEntry): string {
  // 자동 답변은 관리자가 직접 보낸 것과 구분해야 이미 답한 것으로 착각하지 않는다.
  if (entry.kind === "outbound" && entry.auto) return "자동 발송";
  return LABEL[entry.kind];
}

function authorText(entry: TimelineEntry): string {
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

function Avatar({ entry }: { entry: TimelineEntry }) {
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
                <img src={attachment.signedUrl} alt={attachment.fileName} loading="lazy" className="max-h-48 w-auto object-contain" />
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

/** 문의 본문·답변·회신·메모를 시간순 말풍선으로. 데이터 순서는 lib/timeline이 정한다. */
export default function InboxTimeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <ol className="flex flex-col gap-4">
      {entries.map((entry) => {
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
                className={`rounded-xl border px-3.5 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                  note ? "bg-amber-50 border-amber-200 text-amber-900" : "bg-panel border-line"
                }`}
              >
                {entry.body}
              </div>
              {entry.kind === "inquiry" && <Attachments attachments={entry.attachments} />}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
