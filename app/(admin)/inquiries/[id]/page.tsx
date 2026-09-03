import { notFound, redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { getInquiryById } from "@/lib/inquiries";
import { legacyInquiryRedirectHref } from "@/lib/inquiry-filters";

export const dynamic = "force-dynamic";

/**
 * 예전 상세 URL. 이미 나간 Slack 메시지의 링크가 여기를 가리키므로
 * 인박스 URL로 보내기만 한다. 새 링크는 만들지 않는다.
 */
export default async function LegacyInquiryPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { list?: string | string[] };
}) {
  const supabase = getSupabaseServerClient();
  const inquiry = await getInquiryById(supabase, params.id);
  if (!inquiry) {
    notFound();
  }
  const listParam = Array.isArray(searchParams.list) ? searchParams.list[0] : searchParams.list;
  redirect(legacyInquiryRedirectHref(inquiry.gameId, inquiry.id, listParam));
}
