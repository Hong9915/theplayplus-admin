import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import {
  getInquiryById,
  getInquiryFacetCounts,
  listAttachmentSignedUrls,
  listInquiryIds,
  queryInquiries,
} from "@/lib/inquiries";
import { parseInquiryListQuery } from "@/lib/inquiry-filters";
import { listCategoryLabels, listGames } from "@/lib/categories";
import { getAccountHistory } from "@/lib/account-history";
import { listNotes } from "@/lib/notes";
import { listEvents } from "@/lib/events";
import { listTemplates } from "@/lib/templates";
import { listMessages } from "@/lib/messages";
import InboxShell, { type InboxSelection } from "@/components/inbox/InboxShell";

export const dynamic = "force-dynamic";

/**
 * 인박스 한 화면. /games/{g}/inquiries 는 목록만, /games/{g}/inquiries/{id} 는
 * 대화·상세까지. 필터는 같은 URL의 쿼리로 남으므로 문의를 골라도 목록 상태가 유지된다.
 */
export default async function InboxPage({
  params,
  searchParams,
}: {
  params: { gameId: string; inquiryId?: string[] };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  if (params.inquiryId && params.inquiryId.length > 1) {
    notFound();
  }
  const inquiryId = params.inquiryId?.[0] ?? null;

  const supabase = getSupabaseServerClient();
  const query = parseInquiryListQuery(searchParams);

  const [games, labels, counts, listPage] = await Promise.all([
    listGames(supabase),
    listCategoryLabels(supabase, params.gameId),
    getInquiryFacetCounts(supabase, params.gameId),
    queryInquiries(supabase, params.gameId, query),
  ]);

  const game = games.find((entry) => entry.id === params.gameId);
  if (!game) {
    notFound();
  }

  let selected: InboxSelection | null = null;
  if (inquiryId) {
    const inquiry = await getInquiryById(supabase, inquiryId);
    if (!inquiry || inquiry.gameId !== params.gameId) {
      notFound();
    }
    const [attachments, history, notes, events, templates, messages, siblingIds] = await Promise.all([
      listAttachmentSignedUrls(supabase, inquiry.id),
      getAccountHistory(supabase, inquiry.gameId, inquiry.gameAccount, inquiry.id),
      listNotes(supabase, inquiry.id),
      listEvents(supabase, inquiry.id),
      listTemplates(supabase, inquiry.gameId),
      listMessages(supabase, inquiry.id),
      listInquiryIds(supabase, inquiry.gameId, query),
    ]);
    selected = { inquiry, attachments, history, notes, events, templates, messages, siblingIds };
  }

  return <InboxShell game={game} query={query} labels={labels} counts={counts} listPage={listPage} selected={selected} />;
}
