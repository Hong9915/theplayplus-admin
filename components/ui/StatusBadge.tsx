import type { InquiryStatus } from "@/lib/inquiries";

const STATUS_LABEL: Record<InquiryStatus, string> = {
  new: "접수",
  in_progress: "처리중",
  resolved: "완료",
};

const STATUS_STYLE: Record<InquiryStatus, string> = {
  new: "bg-accent/10 text-accent border border-accent/30",
  in_progress: "bg-amber-50 text-amber-700 border border-amber-200",
  resolved: "bg-emerald-50 text-emerald-700 border border-emerald-200",
};

export default function StatusBadge({ status }: { status: InquiryStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}
