import type { InquiryRow, AttachmentWithUrl } from "@/lib/inquiries";
import { formatReceivedAt } from "@/lib/format";

const CARD = "bg-panel border border-line rounded-2xl p-4";

export default function InquiryDetail({
  inquiry,
  attachments,
}: {
  inquiry: InquiryRow;
  attachments: AttachmentWithUrl[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <section className={CARD}>
        <h2 className="font-semibold mb-3">문의 내용</h2>
        <p className="whitespace-pre-wrap">{inquiry.content}</p>
      </section>

      {attachments.length > 0 && (
        <section className={CARD}>
          <h2 className="font-semibold mb-3">첨부파일</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {attachments.map((attachment) => (
              <li key={attachment.id}>
                {attachment.signedUrl ? (
                  <a href={attachment.signedUrl} target="_blank" rel="noreferrer" className="text-accent underline">
                    {attachment.fileName}
                  </a>
                ) : (
                  <span className="text-muted">{attachment.fileName} (링크 생성 실패)</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {inquiry.replyContent && (
        <section className={CARD}>
          <h2 className="font-semibold mb-3">
            보낸 답변
            {inquiry.repliedAt && (
              <span className="ml-2 text-sm font-normal text-muted">{formatReceivedAt(inquiry.repliedAt)}</span>
            )}
          </h2>
          <p className="whitespace-pre-wrap">{inquiry.replyContent}</p>
        </section>
      )}
    </div>
  );
}
