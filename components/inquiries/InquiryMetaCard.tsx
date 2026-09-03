import type { InquiryRow } from "@/lib/inquiries";
import { inquiryMetaRows } from "@/lib/format";

export default function InquiryMetaCard({ inquiry }: { inquiry: InquiryRow }) {
  const rows = inquiryMetaRows(inquiry);

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
