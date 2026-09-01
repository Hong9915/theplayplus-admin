import Link from "next/link";
import type { InquiryRow, InquiryStatus } from "@/lib/inquiries";
import StatusBadge from "@/components/ui/StatusBadge";

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
      <nav className="flex gap-2 text-sm">
        {FILTERS.map((filter) => (
          <Link
            key={filter.value}
            href={filter.value === "all" ? `/games/${gameId}/inquiries` : `/games/${gameId}/inquiries?status=${filter.value}`}
            className={`rounded-full px-3 py-1 transition-colors ${
              filter.value === activeStatus ? "bg-accent/15 text-accent font-medium" : "text-white/60 hover:text-white"
            }`}
          >
            {filter.label}
          </Link>
        ))}
      </nav>
      {inquiries.length === 0 ? (
        <p className="text-white/50 text-sm border border-dashed border-white/15 rounded-lg p-6 text-center">
          접수된 문의가 없습니다.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {inquiries.map((inquiry) => (
            <li
              key={inquiry.id}
              className="border border-white/10 rounded-lg p-4 bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
            >
              <Link href={`/inquiries/${inquiry.id}`} className="flex items-center justify-between">
                <span>{inquiry.title}</span>
                <StatusBadge status={inquiry.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
