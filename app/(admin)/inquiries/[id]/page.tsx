import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { getInquiryById, listAttachmentSignedUrls, listInquiryIds } from "@/lib/inquiries";
import { parseInquiryListQuery } from "@/lib/inquiry-filters";
import { getAccountHistory } from "@/lib/account-history";
import { listCategoryLabels } from "@/lib/categories";
import { listNotes } from "@/lib/notes";
import { listEvents } from "@/lib/events";
import { listTemplates } from "@/lib/templates";
import { listMessages } from "@/lib/messages";
import InquiryHeader from "@/components/inquiries/InquiryHeader";
import InquiryDetail from "@/components/inquiries/InquiryDetail";
import InquiryThread from "@/components/inquiries/InquiryThread";
import InquiryMetaCard from "@/components/inquiries/InquiryMetaCard";
import InquiryNotes from "@/components/inquiries/InquiryNotes";
import InquiryEventLog from "@/components/inquiries/InquiryEventLog";
import StatusSelect from "@/components/inquiries/StatusSelect";
import PrioritySelect from "@/components/inquiries/PrioritySelect";
import ReplyForm from "@/components/inquiries/ReplyForm";
import AccountHistoryPanel from "@/components/inquiries/AccountHistoryPanel";
import InquiryNav from "@/components/inquiries/InquiryNav";
import ResolveButton from "@/components/inquiries/ResolveButton";

export const dynamic = "force-dynamic";

export default async function InquiryDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { list?: string | string[] };
}) {
  const supabase = getSupabaseServerClient();
  const inquiry = await getInquiryById(supabase, params.id);

  // 목록에서 들고 온 필터·정렬. 없으면 기본 목록 기준으로 이전/다음을 계산한다.
  const listParam = Array.isArray(searchParams.list) ? searchParams.list[0] : searchParams.list;
  const listQuery = parseInquiryListQuery(listParam ?? "");

  if (!inquiry) {
    notFound();
  }

  const [attachments, history, labels, notes, events, templates, messages, siblingIds] = await Promise.all([
    listAttachmentSignedUrls(supabase, inquiry.id),
    getAccountHistory(supabase, inquiry.gameId, inquiry.gameAccount, inquiry.id),
    listCategoryLabels(supabase, inquiry.gameId),
    listNotes(supabase, inquiry.id),
    listEvents(supabase, inquiry.id),
    listTemplates(supabase, inquiry.gameId),
    listMessages(supabase, inquiry.id),
    listInquiryIds(supabase, inquiry.gameId, listQuery),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <InquiryNav gameId={inquiry.gameId} inquiryId={inquiry.id} query={listQuery} ids={siblingIds} />

      <InquiryHeader
        inquiry={inquiry}
        labels={labels}
        actions={<ResolveButton inquiryId={inquiry.id} currentStatus={inquiry.status} />}
      />

      <div className="grid grid-cols-[2fr_1fr] gap-6 items-start">
        <div className="flex flex-col gap-4">
          <InquiryDetail inquiry={inquiry} attachments={attachments} />
          <InquiryThread inquiryId={inquiry.id} messages={messages} hasGmailThread={inquiry.gmailThreadId !== null} />
          <InquiryNotes inquiryId={inquiry.id} notes={notes} />
          <section className="bg-panel border border-line rounded-2xl p-4">
            <h2 className="font-semibold mb-3">답변</h2>
            <ReplyForm
              inquiryId={inquiry.id}
              initialDraft={inquiry.draftReply}
              templates={templates}
              typeKey={inquiry.typeKey}
            />
          </section>
        </div>

        <div className="flex flex-col gap-4">
          <section className="bg-panel border border-line rounded-2xl p-4">
            <h2 className="font-semibold mb-3">처리</h2>
            <div className="flex flex-col gap-3">
              <StatusSelect inquiryId={inquiry.id} currentStatus={inquiry.status} />
              <PrioritySelect inquiryId={inquiry.id} currentPriority={inquiry.priority} />
            </div>
          </section>
          <InquiryMetaCard inquiry={inquiry} />
          <InquiryEventLog events={events} createdAt={inquiry.createdAt} />
          <AccountHistoryPanel history={history} gameAccount={inquiry.gameAccount} currentTypeKey={inquiry.typeKey} gameId={inquiry.gameId} />
        </div>
      </div>
    </div>
  );
}
