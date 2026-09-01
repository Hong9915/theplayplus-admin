import { getSupabaseServerClient } from "@/lib/supabase";
import { listInquiriesByGame, type InquiryStatus } from "@/lib/inquiries";
import InquiryList from "@/components/inquiries/InquiryList";

const VALID_STATUSES: InquiryStatus[] = ["new", "in_progress", "resolved"];

export default async function GameInquiriesPage({
  params,
  searchParams,
}: {
  params: { gameId: string };
  searchParams: { status?: string };
}) {
  const status = VALID_STATUSES.includes(searchParams.status as InquiryStatus)
    ? (searchParams.status as InquiryStatus)
    : undefined;

  const supabase = getSupabaseServerClient();
  const inquiries = await listInquiriesByGame(supabase, params.gameId, status);

  return (
    <main className="p-8">
      <h1 className="text-xl font-bold mb-6">문의 목록</h1>
      <InquiryList inquiries={inquiries} activeStatus={status ?? "all"} gameId={params.gameId} />
    </main>
  );
}
