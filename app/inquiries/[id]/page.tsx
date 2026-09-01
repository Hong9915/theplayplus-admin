import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { getInquiryById, listAttachmentSignedUrls } from "@/lib/inquiries";
import { getAccountHistory } from "@/lib/account-history";
import InquiryDetail from "@/components/inquiries/InquiryDetail";
import StatusSelect from "@/components/inquiries/StatusSelect";
import ReplyForm from "@/components/inquiries/ReplyForm";
import AccountHistoryPanel from "@/components/inquiries/AccountHistoryPanel";

export default async function InquiryDetailPage({ params }: { params: { id: string } }) {
  const supabase = getSupabaseServerClient();
  const inquiry = await getInquiryById(supabase, params.id);

  if (!inquiry) {
    notFound();
  }

  const [attachments, history] = await Promise.all([
    listAttachmentSignedUrls(supabase, inquiry.id),
    getAccountHistory(supabase, inquiry.gameId, inquiry.gameAccount, inquiry.id),
  ]);

  return (
    <main className="p-8 grid grid-cols-[2fr_1fr] gap-8">
      <div className="flex flex-col gap-6">
        <InquiryDetail inquiry={inquiry} attachments={attachments} />
        <StatusSelect inquiryId={inquiry.id} currentStatus={inquiry.status} />
        <ReplyForm inquiryId={inquiry.id} />
      </div>
      <AccountHistoryPanel history={history} gameAccount={inquiry.gameAccount} />
    </main>
  );
}
