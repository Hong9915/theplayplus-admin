import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { createType, typeCreateSchema } from "@/lib/category-settings";
import { failed, fromResult, invalidInput, unauthorized } from "@/lib/category-settings-response";

/** 문의 유형 추가. 키는 게임 안에서 하나여야 하고 이후 바꿀 수 없다. */
export async function POST(request: Request, { params }: { params: { gameId: string } }) {
  if (!(await requireAdminSession())) return unauthorized();

  const body = await request.json().catch(() => null);
  const parsed = typeCreateSchema.safeParse(body);
  if (!parsed.success) return invalidInput(parsed.error);

  try {
    return fromResult(await createType(getSupabaseServerClient(), params.gameId, parsed.data));
  } catch {
    return failed();
  }
}
