import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { deleteType, typeUpdateSchema, updateType } from "@/lib/category-settings";
import { failed, fromResult, invalidInput, unauthorized } from "@/lib/category-settings-response";

type Params = { params: { gameId: string; typeId: string } };

/** 유형 이름·소속 종류·기본 우선순위·접수 폼 항목 수정. 키는 바꾸지 않는다. */
export async function PATCH(request: Request, { params }: Params) {
  if (!(await requireAdminSession())) return unauthorized();

  const body = await request.json().catch(() => null);
  const parsed = typeUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidInput(parsed.error);

  try {
    return fromResult(await updateType(getSupabaseServerClient(), params.gameId, params.typeId, parsed.data));
  } catch {
    return failed();
  }
}

/** 그 게임에 이 유형 키로 접수된 문의·연결된 답변 템플릿이 없을 때만 지운다. */
export async function DELETE(_request: Request, { params }: Params) {
  if (!(await requireAdminSession())) return unauthorized();

  try {
    return fromResult(await deleteType(getSupabaseServerClient(), params.gameId, params.typeId));
  } catch {
    return failed();
  }
}
