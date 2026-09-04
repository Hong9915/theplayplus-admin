import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getInquiryById,
  getInquiryFacetCounts,
  listAttachmentSignedUrlsByInquiryIds,
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
 *
 * DB 왕복은 세 묶음으로 끝낸다. URL만 알면 되는 조회(목록·문의 행·메시지·메모·이벤트·템플릿·형제 id)는
 * 한 번에 시작하고, 계정 이력은 문의 행의 game_account가 필요해 그다음, 과거 문의의 메시지·메모와
 * 첨부(현재 문의 것까지 한 번에)는 이력 id가 필요해 마지막이다.
 */
export async function loadInboxPage(
  supabase: SupabaseClient,
  scope: InboxScope,
  inquiryId: string | null,
  searchParams: Record<string, string | string[] | undefined>
): Promise<InboxPageData | null> {
  const query = parseInquiryListQuery(searchParams);
  // 계정 이력·같은 계정 이어보기·답변 템플릿은 게임에 딸린 것이라 서비스 문의에는 없다.
  const gameId = scope.kind === "game" ? scope.gameId : null;

  const [games, labels, counts, listPage, inquiry, notes, events, templates, messages, siblingIds] = await Promise.all([
    gameId ? listGames(supabase) : Promise.resolve([] as GameRow[]),
    listCategoryLabelsForScope(supabase, scope),
    getInquiryFacetCounts(supabase, scope),
    queryInquiries(supabase, scope, query),
    inquiryId ? getInquiryById(supabase, inquiryId) : Promise.resolve(null),
    inquiryId ? listNotes(supabase, inquiryId) : Promise.resolve([]),
    inquiryId ? listEvents(supabase, inquiryId) : Promise.resolve([]),
    inquiryId && gameId ? listTemplates(supabase, gameId) : Promise.resolve([] as TemplateRow[]),
    inquiryId ? listMessages(supabase, inquiryId) : Promise.resolve([]),
    inquiryId ? listInquiryIds(supabase, scope, query) : Promise.resolve([] as string[]),
  ]);

  let game: GameRow | null = null;
  if (gameId) {
    game = games.find((entry) => entry.id === gameId) ?? null;
    if (!game) return null;
  }
  const title = game ? game.name : SERVICE_SCOPE_TITLE;

  let selected: InboxSelection | null = null;
  if (inquiryId) {
    if (!inquiry || !inquiryBelongsToScope(scope, inquiry.gameId)) {
      return null;
    }

    const history = gameId ? await getAccountHistory(supabase, gameId, inquiry.gameAccount, inquiry.id) : null;

    // 같은 계정의 다른 문의도 대화 열에 이어 보여준다. 이력 id로 메시지·메모·첨부를 한 번에 가져온다.
    const historyEntries = history ?? [];
    const historyIds = historyEntries.map((entry) => entry.id);
    const [pastMessages, pastNotes, attachmentsByInquiry] = await Promise.all([
      listMessagesByInquiryIds(supabase, historyIds),
      listNotesByInquiryIds(supabase, historyIds),
      listAttachmentSignedUrlsByInquiryIds(supabase, [inquiry.id, ...historyIds]),
    ]);
    const pastThreads: AccountThread[] = historyEntries.map((entry) => ({
      inquiry: { ...entry, gameAccount: inquiry.gameAccount },
      attachments: attachmentsByInquiry[entry.id] ?? [],
      messages: pastMessages[entry.id] ?? [],
      notes: pastNotes[entry.id] ?? [],
    }));

    selected = {
      inquiry,
      attachments: attachmentsByInquiry[inquiry.id] ?? [],
      history,
      notes,
      events,
      templates,
      messages,
      siblingIds,
      pastThreads,
    };
  }

  return { scope, title, game, query, labels, counts, listPage, selected };
}
