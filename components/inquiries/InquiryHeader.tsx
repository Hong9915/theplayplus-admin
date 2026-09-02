import type { InquiryRow } from "@/lib/inquiries";
import type { CategoryLabelMaps } from "@/lib/categories";
import StatusBadge from "@/components/ui/StatusBadge";
import { formatElapsed, formatReceivedAt } from "@/lib/format";

export default function InquiryHeader({
  inquiry,
  labels,
}: {
  inquiry: InquiryRow;
  labels: CategoryLabelMaps;
}) {
  return (
    <header className="flex flex-col gap-2">
      <h1 className="text-xl font-bold flex items-baseline gap-3">
        <span className="font-mono text-base text-muted">{inquiry.inquiryNo ?? "—"}</span>
        <span>{inquiry.title}</span>
      </h1>
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
