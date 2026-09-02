import type { InquiryRow } from "@/lib/inquiries";
import { formatReceivedAt, metaEntries } from "@/lib/format";

export default function InquiryMetaCard({ inquiry }: { inquiry: InquiryRow }) {
  const fixed: Array<{ label: string; value: string | null }> = [
    { label: "게임 계정", value: inquiry.gameAccount },
    { label: "회사명", value: inquiry.companyName },
    { label: "회신 이메일", value: inquiry.replyEmail },
    { label: "접수 시각", value: formatReceivedAt(inquiry.createdAt) },
  ];

  const rows = [
    ...fixed
      .filter((row) => row.value && row.value.trim() !== "")
      .map((row) => ({ key: row.label, label: row.label, value: row.value as string })),
    ...metaEntries(inquiry.meta),
  ];

  return (
    <section className="bg-panel border border-line rounded-2xl p-4">
      <h2 className="font-semibold mb-3">접수 정보</h2>
      <dl className="flex flex-col gap-2 text-sm">
        {rows.map((row) => (
          <div key={row.key} className="flex items-start justify-between gap-3">
            <dt className="text-muted shrink-0">{row.label}</dt>
            <dd className="text-right break-all">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
