import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { orderSchema, saveOrder } from "@/lib/category-settings";
import { failed, fromResult, invalidInput, unauthorized } from "@/lib/category-settings-response";

/** 종류 순서와 종류 안의 유형 순서를 통째로 저장한다. 지금 구성과 다르면 409 order_mismatch. */
export async function PUT(request: Request, { params }: { params: { gameId: string } }) {
  if (!(await requireAdminSession())) return unauthorized();

  const body = await request.json().catch(() => null);
  const parsed = orderSchema.safeParse(body);
  if (!parsed.success) return invalidInput(parsed.error);

  try {
    return fromResult(await saveOrder(getSupabaseServerClient(), params.gameId, parsed.data));
  } catch {
    return failed();
  }
}
