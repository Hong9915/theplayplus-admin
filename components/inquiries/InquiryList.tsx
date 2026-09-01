import Link from "next/link";
import type { InquiryRow, InquiryStatus } from "@/lib/inquiries";

const STATUS_LABEL: Record<InquiryStatus, string> = {
  new: "접수",
  in_progress: "처리중",
  resolved: "완료",
};

const FILTERS: Array<{ value: InquiryStatus | "all"; label: string }> = [
  { value: "all", label: "전체" },
  { value: "new", label: "접수" },
  { value: "in_progress", label: "처리중" },
  { value: "resolved", label: "완료" },
];

export default function InquiryList({
  inquiries,
  activeStatus,
  gameId,
}: {
  inquiries: InquiryRow[];
  activeStatus: InquiryStatus | "all";
  gameId: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <nav className="flex gap-3 text-sm">
        {FILTERS.map((filter) => (
          <Link
            key={filter.value}
            href={filter.value === "all" ? `/games/${gameId}/inquiries` : `/games/${gameId}/inquiries?status=${filter.value}`}
            className={filter.value === activeStatus ? "font-bold text-accent" : "text-white/60"}
          >
            {filter.label}
          </Link>
        ))}
      </nav>
      {inquiries.length === 0 ? (
        <p>접수된 문의가 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {inquiries.map((inquiry) => (
            <li key={inquiry.id} className="border border-white/10 rounded p-4">
              <Link href={`/inquiries/${inquiry.id}`} className="flex items-center justify-between">
                <span>{inquiry.title}</span>
                <span className="text-sm text-white/60">{STATUS_LABEL[inquiry.status]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
