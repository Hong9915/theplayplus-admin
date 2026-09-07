import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { getAdminSession } from "@/lib/require-admin-session";
import { getConversation, getMessage, updateProposalStatus } from "@/lib/assistant-store";
import { applyProposal, SheetError, type SheetErrorReason } from "@/lib/sheets";
import { getSource } from "@/lib/assistant-sources";

/** 관리자가 [적용]을 누르면 시트에 쓴다. 실패는 200으로 사유를 돌려주고 카드에 남긴다. */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  const message = await getMessage(supabase, params.id);
  if (!message || message.role !== "proposal" || !message.proposal) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }
  if (message.status !== "pending") {
    return NextResponse.json({ success: false, error: "not_pending" }, { status: 409 });
  }

  const conversation = await getConversation(supabase, message.conversationId);

  const fail = async (reason: SheetErrorReason) => {
    await updateProposalStatus(supabase, message.id, { status: "failed", failureReason: reason });
    return NextResponse.json({ success: false, status: "failed", failureReason: reason });
  };

  // 0019 이전에 저장된 제안은 sourceId가 없다. 자료가 해제됐거나 다른 게임·문서를 가리켜도 적용하지 않는다.
  const sourceId = typeof message.proposal.sourceId === "string" ? message.proposal.sourceId : null;
  const source = sourceId ? await getSource(supabase, sourceId) : null;
  if (!conversation || !source || source.kind !== "sheet" || source.gameId !== conversation.gameId) {
    return fail("invalid_proposal");
  }

  try {
    await applyProposal(source.externalId, message.proposal);
  } catch (error) {
    return fail(error instanceof SheetError ? error.reason : "sheet_write_failed");
  }

  const appliedAt = new Date().toISOString();
  await updateProposalStatus(supabase, message.id, { status: "applied", appliedBy: session.email, appliedAt });
  return NextResponse.json({ success: true, status: "applied", appliedBy: session.email, appliedAt });
}
