import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { SERVICE_SCOPE } from "@/lib/inbox-scope";
import { loadInboxPage } from "@/lib/inbox-page";
import InboxShell from "@/components/inbox/InboxShell";

export const dynamic = "force-dynamic";

/**
 * 서비스 문의(제휴·기타) 인박스. 게임 없이 접수된 문의(inquiries.game_id is null)를
 * 게임 인박스와 같은 4단 화면으로 보여준다. 계정 이력·답변 템플릿은 게임에 딸린 것이라 없다.
 */
export default async function ServiceInboxPage({
  params,
  searchParams,
}: {
  params: { inquiryId?: string[] };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  if (params.inquiryId && params.inquiryId.length > 1) {
    notFound();
  }
  const data = await loadInboxPage(getSupabaseServerClient(), SERVICE_SCOPE, params.inquiryId?.[0] ?? null, searchParams);
  if (!data) {
    notFound();
  }
  return <InboxShell {...data} />;
}
