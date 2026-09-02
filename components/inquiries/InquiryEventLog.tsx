import type { EventRow } from "@/lib/events";
import { describeEvent } from "@/lib/events";
import { emailLocalPart, formatReceivedAt } from "@/lib/format";

export default function InquiryEventLog({
  events,
  createdAt,
}: {
  events: EventRow[];
  createdAt: string;
}) {
  return (
    <section className="bg-panel border border-line rounded-2xl p-4">
      <h2 className="font-semibold mb-3">변경 이력</h2>
      <ul className="flex flex-col gap-3 text-sm">
        {events.map((event) => (
          <li key={event.id}>
            <p className="text-xs text-muted">{formatReceivedAt(event.createdAt)}</p>
            <p>{describeEvent(event)}</p>
            <p className="text-xs text-muted" title={event.actorEmail}>
              {emailLocalPart(event.actorEmail)}
            </p>
          </li>
        ))}

        {/* 접수 이벤트는 저장하지 않는다. contact 폼이 anon으로 직접 insert하므로
            저장하려면 트리거가 필요한데, created_at이 이미 같은 정보를 갖고 있다. */}
        <li>
          <p className="text-xs text-muted">{formatReceivedAt(createdAt)}</p>
          <p>접수</p>
          <p className="text-xs text-muted">사용자</p>
        </li>
      </ul>
    </section>
  );
}
