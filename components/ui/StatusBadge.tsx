import type { InquiryStatus } from "@/lib/inquiries";

const STATUS_LABEL: Record<InquiryStatus, string> = {
  new: "접수",
  in_progress: "처리중",
  resolved: "완료",
};

const STATUS_STYLE: Record<InquiryStatus, string> = {
  new: "bg-white/10 text-white/80",
  in_progress: "bg-amber-500/15 text-amber-400",
  resolved: "bg-emerald-500/15 text-emerald-400",
};

export default function StatusBadge({ status }: { status: InquiryStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}
