import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { createGroup, groupCreateSchema } from "@/lib/category-settings";
import { failed, fromResult, invalidInput, unauthorized } from "@/lib/category-settings-response";

/** 문의 종류 추가. 키는 이후 바꿀 수 없다. */
export async function POST(request: Request, { params }: { params: { gameId: string } }) {
  if (!(await requireAdminSession())) return unauthorized();

  const body = await request.json().catch(() => null);
  const parsed = groupCreateSchema.safeParse(body);
  if (!parsed.success) return invalidInput(parsed.error);

  try {
    return fromResult(await createGroup(getSupabaseServerClient(), params.gameId, parsed.data));
  } catch {
    return failed();
  }
}
