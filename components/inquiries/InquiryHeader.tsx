import type { ReactNode } from "react";
import type { InquiryRow } from "@/lib/inquiries";
import type { CategoryLabelMaps } from "@/lib/categories";
import StatusBadge from "@/components/ui/StatusBadge";
import { formatElapsed, formatReceivedAt } from "@/lib/format";

export default function InquiryHeader({
  inquiry,
  labels,
  actions,
}: {
  inquiry: InquiryRow;
  labels: CategoryLabelMaps;
  /** 제목 줄 오른쪽에 놓을 버튼. 완료 처리처럼 자주 누르는 것만. */
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-xl font-bold flex items-baseline gap-3 min-w-0">
          <span className="font-mono text-base text-muted shrink-0">{inquiry.inquiryNo ?? "—"}</span>
          <span className="break-words">{inquiry.title}</span>
        </h1>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        <StatusBadge status={inquiry.status} />
        <span>{labels.groupLabels[inquiry.groupKey] ?? inquiry.groupKey}</span>
        <span>{labels.typeLabels[inquiry.typeKey] ?? inquiry.typeKey}</span>
        <span>
          접수 {formatReceivedAt(inquiry.createdAt)} · 경과 {formatElapsed(inquiry.createdAt)}
        </span>
      </div>
    </header>
  );
}
