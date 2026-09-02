import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { getInquiryById, listAttachmentSignedUrls } from "@/lib/inquiries";
import { getAccountHistory } from "@/lib/account-history";
import { listCategoryLabels } from "@/lib/categories";
import { listNotes } from "@/lib/notes";
import { listEvents } from "@/lib/events";
import InquiryHeader from "@/components/inquiries/InquiryHeader";
import InquiryDetail from "@/components/inquiries/InquiryDetail";
import InquiryMetaCard from "@/components/inquiries/InquiryMetaCard";
import InquiryNotes from "@/components/inquiries/InquiryNotes";
import InquiryEventLog from "@/components/inquiries/InquiryEventLog";
import StatusSelect from "@/components/inquiries/StatusSelect";
import PrioritySelect from "@/components/inquiries/PrioritySelect";
import ReplyForm from "@/components/inquiries/ReplyForm";
import AccountHistoryPanel from "@/components/inquiries/AccountHistoryPanel";

export const dynamic = "force-dynamic";

export default async function InquiryDetailPage({ params }: { params: { id: string } }) {
  const supabase = getSupabaseServerClient();
  const inquiry = await getInquiryById(supabase, params.id);

  if (!inquiry) {
    notFound();
  }

  const [attachments, history, labels, notes, events] = await Promise.all([
    listAttachmentSignedUrls(supabase, inquiry.id),
    getAccountHistory(supabase, inquiry.gameId, inquiry.gameAccount, inquiry.id),
    listCategoryLabels(supabase, inquiry.gameId),
    listNotes(supabase, inquiry.id),
    listEvents(supabase, inquiry.id),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/games/${inquiry.gameId}/inquiries`}
        className="text-sm text-muted hover:text-ink transition-colors"
      >
        ← 목록
      </Link>

      <InquiryHeader inquiry={inquiry} labels={labels} />

      <div className="grid grid-cols-[2fr_1fr] gap-6 items-start">
        <div className="flex flex-col gap-4">
          <InquiryDetail inquiry={inquiry} attachments={attachments} />
          <InquiryNotes inquiryId={inquiry.id} notes={notes} />
          <section className="bg-panel border border-line rounded-2xl p-4">
            <h2 className="font-semibold mb-3">답변</h2>
            <ReplyForm inquiryId={inquiry.id} initialDraft={inquiry.draftReply} />
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
          <AccountHistoryPanel history={history} gameAccount={inquiry.gameAccount} />
        </div>
      </div>
    </div>
  );
}
