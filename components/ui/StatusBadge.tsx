import type { InquiryStatus } from "@/lib/inquiries";

const STATUS_LABEL: Record<InquiryStatus, string> = {
  new: "접수",
  in_progress: "처리중",
  resolved: "완료",
};

// 주황은 "새로 들어온 일"에만. 처리중은 잉크 테두리, 완료는 가라앉은 초록.
const STATUS_STYLE: Record<InquiryStatus, string> = {
  new: "bg-accent-wash text-accent-ink",
  in_progress: "ring-1 ring-inset ring-ink-2/40 text-ink-2",
  resolved: "bg-done-wash text-done",
};

export default function StatusBadge({ status }: { status: InquiryStatus }) {
  return (
    <span className={`inline-flex items-center shrink-0 whitespace-nowrap h-[22px] rounded-md px-2 text-xs font-semibold ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}
