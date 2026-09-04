import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getInquiryById,
  getInquiryFacetCounts,
  listAttachmentSignedUrls,
  listInquiryIds,
  queryInquiries,
  type InquiryFacetCounts,
  type InquiryPage,
} from "@/lib/inquiries";
import { parseInquiryListQuery, type InquiryListQuery } from "@/lib/inquiry-filters";
import { SERVICE_SCOPE_TITLE, inquiryBelongsToScope, type InboxScope } from "@/lib/inbox-scope";
import { listCategoryLabelsForScope, listGames, type CategoryLabelMaps, type GameRow } from "@/lib/categories";
import { getAccountHistory, type AccountHistoryEntry } from "@/lib/account-history";
import { listNotes, listNotesByInquiryIds } from "@/lib/notes";
import { listEvents } from "@/lib/events";
import { listTemplates, type TemplateRow } from "@/lib/templates";
import { listMessages, listMessagesByInquiryIds } from "@/lib/messages";
import type { AccountThread } from "@/lib/timeline";
import type { InboxSelection } from "@/components/inbox/InboxShell";

export interface InboxPageData {
  scope: InboxScope;
  title: string;
  /** 게임 스코프에서만. 서비스 문의에는 게임이 없다. */
  game: GameRow | null;
  query: InquiryListQuery;
  labels: CategoryLabelMaps;
  counts: InquiryFacetCounts | null;
  listPage: InquiryPage;
  selected: InboxSelection | null;
}

/**
 * 인박스 한 화면의 데이터. 게임 페이지와 서비스 페이지가 스코프만 다르게 이 함수를 부른다.
 * 스코프의 게임이 없거나, 고른 문의가 없거나 스코프 밖이면 null — 페이지가 notFound()로 바꾼다.
 */
export async function loadInboxPage(
  supabase: SupabaseClient,
  scope: InboxScope,
  inquiryId: string | null,
  searchParams: Record<string, string | string[] | undefined>
): Promise<InboxPageData | null> {
  const query = parseInquiryListQuery(searchParams);

  const [games, labels, counts, listPage] = await Promise.all([
    scope.kind === "game" ? listGames(supabase) : Promise.resolve([] as GameRow[]),
    listCategoryLabelsForScope(supabase, scope),
    getInquiryFacetCounts(supabase, scope),
    queryInquiries(supabase, scope, query),
  ]);

  let game: GameRow | null = null;
  if (scope.kind === "game") {
    game = games.find((entry) => entry.id === scope.gameId) ?? null;
    if (!game) return null;
  }
  const title = game ? game.name : SERVICE_SCOPE_TITLE;

  let selected: InboxSelection | null = null;
  if (inquiryId) {
    const inquiry = await getInquiryById(supabase, inquiryId);
    if (!inquiry || !inquiryBelongsToScope(scope, inquiry.gameId)) {
      return null;
    }

    // 계정 이력·같은 계정 이어보기·답변 템플릿은 게임에 딸린 것이라 서비스 문의에는 없다.
    const gameId = scope.kind === "game" ? scope.gameId : null;
    const [attachments, history, notes, events, templates, messages, siblingIds] = await Promise.all([
      listAttachmentSignedUrls(supabase, inquiry.id),
      gameId ? getAccountHistory(supabase, gameId, inquiry.gameAccount, inquiry.id) : Promise.resolve<AccountHistoryEntry[] | null>(null),
      listNotes(supabase, inquiry.id),
      listEvents(supabase, inquiry.id),
      gameId ? listTemplates(supabase, gameId) : Promise.resolve([] as TemplateRow[]),
      listMessages(supabase, inquiry.id),
      listInquiryIds(supabase, scope, query),
    ]);

    // 같은 계정의 다른 문의도 대화 열에 이어 보여준다. 이력 id로 메시지·메모·첨부를 한 번에 가져온다.
    const historyEntries = history ?? [];
    const historyIds = historyEntries.map((entry) => entry.id);
    const [pastMessages, pastNotes, pastAttachments] = await Promise.all([
      listMessagesByInquiryIds(supabase, historyIds),
      listNotesByInquiryIds(supabase, historyIds),
      Promise.all(historyEntries.map((entry) => listAttachmentSignedUrls(supabase, entry.id))),
    ]);
    const pastThreads: AccountThread[] = historyEntries.map((entry, index) => ({
      inquiry: { ...entry, gameAccount: inquiry.gameAccount },
      attachments: pastAttachments[index],
      messages: pastMessages[entry.id] ?? [],
      notes: pastNotes[entry.id] ?? [],
    }));

    selected = { inquiry, attachments, history, notes, events, templates, messages, siblingIds, pastThreads };
  }

  return { scope, title, game, query, labels, counts, listPage, selected };
}
