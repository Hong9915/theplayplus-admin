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
    return <div className="w-[22px] h-[22px] rounded-full bg-ink text-white flex items-center justify-center text-[9.5px] font-bold tracking-[-.04em] shrink-0">P+</div>;
  }
  if (entry.kind === "note") {
    return (
      <div className="w-[22px] h-[22px] rounded-full bg-memo-line/40 text-memo-ink flex items-center justify-center shrink-0">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
        </svg>
      </div>
    );
  }
  const initial = (entry.author ?? "?").charAt(0).toUpperCase();
  return <div className="w-[22px] h-[22px] rounded-full bg-line-soft text-ink-2 flex items-center justify-center text-[11px] font-bold shrink-0">{initial}</div>;
}

function Attachments({ attachments, alignEnd = false }: { attachments: AttachmentWithUrl[]; alignEnd?: boolean }) {
  if (attachments.length === 0) return null;
  return (
    <ul className={`flex flex-wrap gap-2 text-xs ${alignEnd ? "justify-end" : ""}`} aria-label="첨부 사진">
      {attachments.map((attachment) => (
        <li key={attachment.id} className="flex flex-col gap-1 max-w-[240px]">
          {attachment.signedUrl ? (
            <>
              <a href={attachment.signedUrl} target="_blank" rel="noreferrer" title="원본 크기로 열기" className="block rounded-[10px] overflow-hidden ring-1 ring-line bg-black/5">
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
      <span className={`flex-1 border-t ${entry.current ? "border-ink-2/40" : "border-line"}`} aria-hidden="true" />
      <div
        className={`flex items-center gap-2 max-w-full rounded-full px-3 h-7 text-[12.5px] bg-panel ${
          entry.current ? "ring-1 ring-ink-2/50 text-ink" : "ring-1 ring-line text-muted"
        }`}
      >
        <span className="font-semibold">{entry.inquiryNo ?? "—"}</span>
        <span className={`truncate ${entry.current ? "font-semibold" : "font-medium"}`}>{entry.title}</span>
        <span className="shrink-0">{labels.typeLabels[entry.typeKey] ?? entry.typeKey}</span>
        <StatusBadge status={entry.status} />
        <span className="shrink-0 tabular-nums">{formatReceivedAt(entry.at)}</span>
      </div>
      <span className={`flex-1 border-t ${entry.current ? "border-ink-2/40" : "border-line"}`} aria-hidden="true" />
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
    <ol className="flex flex-col gap-[18px]">
      {hasDividers && <ScrollToCurrent />}
      {entries.map((entry) => {
        if (entry.kind === "divider") {
          return <Divider key={`divider-${entry.id}`} entry={entry} labels={labels} />;
        }
        const outbound = entry.kind === "outbound";
        const auto = outbound && entry.auto;
        const note = entry.kind === "note";
        // 사진만 보낸 답변·회신은 빈 말풍선 없이 사진만 그린다.
        const photoOnly =
          (entry.kind === "outbound" || entry.kind === "inbound") && entry.body.trim() === "" && entry.attachments.length > 0;
        // 고객은 왼쪽 흰 말풍선, 우리가 보낸 것은 오른쪽 주황 말풍선, 자동 발송은 점선, 메모는 폭 전체를 쓰는 호박색.
        const bubble = note
          ? "rounded-xl bg-memo ring-1 ring-memo-line text-memo-ink"
          : auto
            ? "rounded-[16px_4px_16px_16px] border border-dashed border-line text-ink-2 text-[13.5px]"
            : outbound
              ? "rounded-[16px_4px_16px_16px] bg-accent-wash ring-1 ring-accent/20"
              : "rounded-[4px_16px_16px_16px] bg-panel ring-1 ring-line-soft shadow-[0_1px_2px_rgba(0,0,0,.03)]";
        return (
          <li key={`${entry.kind}-${entry.id}`} className={`flex ${outbound ? "justify-end" : ""}`} data-kind={entry.kind}>
            <div className={`flex flex-col gap-1.5 min-w-0 ${note ? "flex-1" : "max-w-[78%]"} ${outbound ? "items-end" : ""}`}>
              <div className={`flex items-center gap-2 text-[12.5px] ${outbound ? "flex-row-reverse" : ""}`}>
                <Avatar entry={entry} />
                <span className={`font-semibold ${note ? "text-memo-ink" : "text-ink-2"}`}>{authorText(entry)}</span>
                <span className={note ? "text-memo-ink/80" : "text-muted"}>{labelText(entry)}</span>
                {note && <span className="text-memo-ink/80">· 고객에게 보이지 않음</span>}
                <span className={`tabular-nums ${note ? "text-memo-ink/80" : "text-muted"}`}>{formatReceivedAt(entry.at)}</span>
              </div>
              {!photoOnly && (
                <div className={`px-4 py-3.5 text-[14.5px] leading-[1.7] ${bubble}`}>
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
                    <dl className="mt-3 px-3.5 py-3 rounded-[10px] bg-well grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5 text-[13px]" data-testid="inquiry-details">
                      {entry.details.map((row) => (
                        <div key={row.key} className="contents">
                          <dt className="text-muted">{row.label}</dt>
                          <dd className="break-all font-medium">{row.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              )}
              {entry.kind !== "note" && <Attachments attachments={entry.attachments} alignEnd={outbound} />}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
