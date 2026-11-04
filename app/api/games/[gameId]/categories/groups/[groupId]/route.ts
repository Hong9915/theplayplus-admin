import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { deleteGroup, groupUpdateSchema, updateGroup } from "@/lib/category-settings";
import { failed, fromResult, invalidInput, unauthorized } from "@/lib/category-settings-response";

type Params = { params: { gameId: string; groupId: string } };

/** 종류 이름(ko/zh/en) 수정. 키·순서는 여기서 바꾸지 않는다. */
export async function PATCH(request: Request, { params }: Params) {
  if (!(await requireAdminSession())) return unauthorized();

  const body = await request.json().catch(() => null);
  const parsed = groupUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidInput(parsed.error);

  try {
    return fromResult(await updateGroup(getSupabaseServerClient(), params.gameId, params.groupId, parsed.data));
  } catch {
    return failed();
  }
}

/** 유형이 없고 그 종류로 접수된 문의도 없을 때만 지운다. 아니면 409 in_use + 이유. */
export async function DELETE(_request: Request, { params }: Params) {
  if (!(await requireAdminSession())) return unauthorized();

  try {
    return fromResult(await deleteGroup(getSupabaseServerClient(), params.gameId, params.groupId));
  } catch {
    return failed();
  }
}
