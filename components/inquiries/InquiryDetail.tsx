import type { InquiryRow, AttachmentWithUrl } from "@/lib/inquiries";

export default function InquiryDetail({
  inquiry,
  attachments,
}: {
  inquiry: InquiryRow;
  attachments: AttachmentWithUrl[];
}) {
  return (
    <article className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-bold">{inquiry.title}</h1>
        <p className="text-sm text-white/60">
          {inquiry.groupKey} · {inquiry.typeKey} · {new Date(inquiry.createdAt).toLocaleString("ko-KR")}
        </p>
      </header>

      <dl className="text-sm flex flex-col gap-1">
        {inquiry.gameAccount && (
          <div>
            <dt className="inline text-white/60">게임 계정: </dt>
            <dd className="inline">{inquiry.gameAccount}</dd>
          </div>
        )}
        {inquiry.companyName && (
          <div>
            <dt className="inline text-white/60">회사명: </dt>
            <dd className="inline">{inquiry.companyName}</dd>
          </div>
        )}
        <div>
          <dt className="inline text-white/60">회신 이메일: </dt>
          <dd className="inline">{inquiry.replyEmail}</dd>
        </div>
      </dl>

      <p className="whitespace-pre-wrap">{inquiry.content}</p>

      {attachments.length > 0 && (
        <div>
          <h2 className="font-semibold mb-2">첨부파일</h2>
          <ul className="flex flex-col gap-1">
            {attachments.map((attachment) => (
              <li key={attachment.id}>
                {attachment.signedUrl ? (
                  <a href={attachment.signedUrl} target="_blank" rel="noreferrer" className="text-accent underline">
                    {attachment.fileName}
                  </a>
                ) : (
                  <span>{attachment.fileName} (링크 생성 실패)</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {inquiry.replyContent && (
        <div className="border border-white/10 rounded p-4">
          <h2 className="font-semibold mb-2">
            보낸 답변 {inquiry.repliedAt && `(${new Date(inquiry.repliedAt).toLocaleString("ko-KR")})`}
          </h2>
          <p className="whitespace-pre-wrap">{inquiry.replyContent}</p>
        </div>
      )}
    </article>
  );
}
