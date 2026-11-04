import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { InquiryTypePriority } from "@/lib/categories";

/**
 * 게임별 문의 종류(inquiry_groups)·유형(inquiry_types) 편집. theplayplus-web의 접수 폼이
 * 이 행을 요청마다 그대로 읽으므로(웹 `src/lib/categories.ts`의 getGameCategories) 저장하면
 * 바로 실서비스 폼이 바뀐다.
 *
 * 키는 만든 뒤 바꾸지 않는다. inquiries.group_key·type_key, reply_templates.type_key와
 * 우선순위 트리거(마이그레이션 0009)가 FK 없이 키 문자열로 이 행을 가리키기 때문이다.
 */

export interface CategoryTypeFlags {
  requiresGameAccount: boolean;
  requiresCompanyName: boolean;
  allowAttachments: boolean;
  requiresAttachments: boolean;
  collectsPaymentNo: boolean;
  collectsOccurredAt: boolean;
  collectsDeviceInfo: boolean;
  collectsStore: boolean;
  collectsCharacter: boolean;
}

export interface CategoryTypeSetting extends CategoryTypeFlags {
  id: string;
  groupId: string;
  key: string;
  labelKo: string;
  labelZh: string | null;
  labelEn: string | null;
  defaultPriority: InquiryTypePriority;
  sortOrder: number;
}

export interface CategoryGroupSetting {
  id: string;
  key: string;
  labelKo: string;
  labelZh: string | null;
  labelEn: string | null;
  sortOrder: number;
  types: CategoryTypeSetting[];
}

/** 화면에 보일 순서. 접수 폼이 묻는 순서(웹 StepDetailForm)를 따른다. */
export const TYPE_FLAG_FIELDS: Array<{ key: keyof CategoryTypeFlags; label: string; hint: string }> = [
  { key: "requiresGameAccount", label: "게임 로그인 이메일 필수", hint: "게임 로그인용 이메일을 받고 이메일 형식인지 확인합니다." },
  { key: "requiresCompanyName", label: "회사명 받기(필수)", hint: "회사명 칸을 필수로 받습니다. 보통 게임 문의에는 끕니다." },
  { key: "collectsStore", label: "스토어 종류 받기(필수)", hint: "Google Play·App Store·원스토어·기타 중 하나를 고르게 합니다." },
  { key: "collectsCharacter", label: "서버·캐릭터 ID·캐릭터명 받기(필수)", hint: "세 칸 모두 필수, 서버는 직접 입력합니다." },
  { key: "collectsPaymentNo", label: "결제번호 받기(필수)", hint: "스토어 영수증의 결제번호를 받습니다." },
  { key: "collectsOccurredAt", label: "발생 일시 받기(필수)", hint: "날짜·시각 칸을 필수로 받습니다." },
  { key: "collectsDeviceInfo", label: "기기 정보 받기(필수)", hint: "기기·사양 정보를 필수로 받습니다." },
  { key: "allowAttachments", label: "첨부 허용", hint: "사진·파일을 붙일 수 있게 합니다." },
  { key: "requiresAttachments", label: "첨부 필수", hint: "첨부 허용이 켜져 있을 때만 쓸 수 있습니다." },
];

export const PRIORITY_OPTIONS: Array<{ value: InquiryTypePriority; label: string }> = [
  { value: "urgent", label: "긴급" },
  { value: "high", label: "높음" },
  { value: "normal", label: "보통" },
  { value: "low", label: "낮음" },
];

/** 새 유형의 기본값. lib/categories.ts의 GAME_TYPE(신규 게임 시드)과 같다. */
export const NEW_TYPE_FLAGS: CategoryTypeFlags = {
  requiresGameAccount: true,
  requiresCompanyName: false,
  allowAttachments: true,
  requiresAttachments: false,
  collectsPaymentNo: false,
  collectsOccurredAt: false,
  collectsDeviceInfo: false,
  collectsStore: true,
  collectsCharacter: false,
};

// 기존 키(account_inquiry, game_usage …)와 같은 모양: 영소문자로 시작, 영소문자·숫자·밑줄.
export const CATEGORY_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

const keySchema = z.string().trim().min(1).max(50).regex(CATEGORY_KEY_PATTERN);
const labelKoSchema = z.string().trim().min(1).max(50);
// 비우면 null — 웹은 빈 번역이면 한국어 이름을 보여 준다.
const optionalLabelSchema = z
  .string()
  .trim()
  .max(50)
  .nullable()
  .optional()
  .transform((value) => (value ? value : null));

const labelsShape = {
  labelKo: labelKoSchema,
  labelZh: optionalLabelSchema,
  labelEn: optionalLabelSchema,
};

const flagsShape = {
  requiresGameAccount: z.boolean(),
  requiresCompanyName: z.boolean(),
  allowAttachments: z.boolean(),
  requiresAttachments: z.boolean(),
  collectsPaymentNo: z.boolean(),
  collectsOccurredAt: z.boolean(),
  collectsDeviceInfo: z.boolean(),
  collectsStore: z.boolean(),
  collectsCharacter: z.boolean(),
};

const prioritySchema = z.enum(["urgent", "high", "normal", "low"]);

/** 첨부 필수는 첨부 허용이 켜져 있어야 뜻이 있다(웹 폼도 둘 다 켜졌을 때만 막는다). */
function attachmentsConsistent(value: { allowAttachments: boolean; requiresAttachments: boolean }) {
  return value.allowAttachments || !value.requiresAttachments;
}
const ATTACHMENT_ISSUE = { message: "requires_attachments_without_allow", path: ["requiresAttachments"] };

export const groupCreateSchema = z.object({ key: keySchema, ...labelsShape });
export const groupUpdateSchema = z.object(labelsShape);

export const typeCreateSchema = z
  .object({ groupId: z.string().min(1), key: keySchema, ...labelsShape, ...flagsShape, defaultPriority: prioritySchema })
  .refine(attachmentsConsistent, ATTACHMENT_ISSUE);

export const typeUpdateSchema = z
  .object({ groupId: z.string().min(1), ...labelsShape, ...flagsShape, defaultPriority: prioritySchema })
  .refine(attachmentsConsistent, ATTACHMENT_ISSUE);

/** 종류 순서와 각 종류 안의 유형 순서를 한 번에 보낸다. 유형을 다른 종류로 옮기는 것은 유형 수정으로 한다. */
export const orderSchema = z.object({
  groups: z.array(z.object({ id: z.string().min(1), typeIds: z.array(z.string().min(1)) })),
});

export type GroupCreateInput = z.infer<typeof groupCreateSchema>;
export type GroupUpdateInput = z.infer<typeof groupUpdateSchema>;
export type TypeCreateInput = z.infer<typeof typeCreateSchema>;
export type TypeUpdateInput = z.infer<typeof typeUpdateSchema>;
export type OrderInput = z.infer<typeof orderSchema>;

/** zod 오류에서 화면이 표시할 칸 이름만 뽑는다. */
export function invalidFields(error: z.ZodError): string[] {
  return Array.from(new Set(error.issues.map((issue) => String(issue.path[0] ?? ""))).values()).filter(Boolean);
}

const GROUP_COLUMNS = "id, key, label_ko, label_zh, label_en, sort_order";
const TYPE_COLUMNS =
  "id, group_id, key, label_ko, label_zh, label_en, requires_game_account, requires_company_name, allow_attachments, requires_attachments, collects_payment_no, collects_occurred_at, collects_device_info, collects_store, collects_character, default_priority, sort_order";

interface GroupDbRow {
  id: string;
  key: string;
  label_ko: string;
  label_zh: string | null;
  label_en: string | null;
  sort_order: number;
}

interface TypeDbRow {
  id: string;
  group_id: string;
  key: string;
  label_ko: string;
  label_zh: string | null;
  label_en: string | null;
  requires_game_account: boolean;
  requires_company_name: boolean;
  allow_attachments: boolean;
  requires_attachments: boolean;
  collects_payment_no: boolean;
  collects_occurred_at: boolean;
  collects_device_info: boolean;
  collects_store: boolean;
  collects_character: boolean;
  default_priority: string;
  sort_order: number;
}

function mapType(row: TypeDbRow): CategoryTypeSetting {
  return {
    id: row.id,
    groupId: row.group_id,
    key: row.key,
    labelKo: row.label_ko,
    labelZh: row.label_zh,
    labelEn: row.label_en,
    requiresGameAccount: row.requires_game_account === true,
    requiresCompanyName: row.requires_company_name === true,
    allowAttachments: row.allow_attachments === true,
    requiresAttachments: row.requires_attachments === true,
    collectsPaymentNo: row.collects_payment_no === true,
    collectsOccurredAt: row.collects_occurred_at === true,
    collectsDeviceInfo: row.collects_device_info === true,
    collectsStore: row.collects_store === true,
    collectsCharacter: row.collects_character === true,
    defaultPriority: (prioritySchema.safeParse(row.default_priority).success ? row.default_priority : "normal") as InquiryTypePriority,
    sortOrder: row.sort_order,
  };
}

/** 정렬 기준이 같을 때도 순서가 흔들리지 않게 키로 한 번 더 가른다(마이그레이션 0007과 같음). */
function bySortOrder<T extends { sortOrder: number; key: string }>(a: T, b: T) {
  return a.sortOrder - b.sortOrder || a.key.localeCompare(b.key);
}

/** 게임의 종류·유형 전부. 읽기 실패는 던진다 — 편집 화면은 이것 없이는 그릴 수 없다. */
export async function listGameCategorySettings(supabase: SupabaseClient, gameId: string): Promise<CategoryGroupSetting[]> {
  const { data: groups, error: groupsError } = await supabase.from("inquiry_groups").select(GROUP_COLUMNS).eq("game_id", gameId);
  if (groupsError || !groups) {
    throw new Error(`Failed to list inquiry groups: ${groupsError?.message ?? "unknown error"}`);
  }
  if (groups.length === 0) return [];

  const { data: types, error: typesError } = await supabase
    .from("inquiry_types")
    .select(TYPE_COLUMNS)
    .in(
      "group_id",
      (groups as GroupDbRow[]).map((group) => group.id)
    );
  if (typesError || !types) {
    throw new Error(`Failed to list inquiry types: ${typesError?.message ?? "unknown error"}`);
  }

  const mappedTypes = (types as TypeDbRow[]).map(mapType);
  return (groups as GroupDbRow[])
    .map((group) => ({
      id: group.id,
      key: group.key,
      labelKo: group.label_ko,
      labelZh: group.label_zh,
      labelEn: group.label_en,
      sortOrder: group.sort_order,
      types: mappedTypes.filter((type) => type.groupId === group.id).sort(bySortOrder),
    }))
    .sort(bySortOrder);
}

function nextSortOrder(rows: Array<{ sortOrder: number }>): number {
  return rows.reduce((max, row) => Math.max(max, row.sortOrder + 1), 0);
}

function findType(groups: CategoryGroupSetting[], typeId: string): CategoryTypeSetting | null {
  for (const group of groups) {
    const found = group.types.find((type) => type.id === typeId);
    if (found) return found;
  }
  return null;
}

/** 유형 키는 게임 안에서 하나여야 한다 — 템플릿·문의는 종류 없이 type_key만으로 유형을 찾는다. */
export function typeKeyTaken(groups: CategoryGroupSetting[], key: string): boolean {
  return groups.some((group) => group.types.some((type) => type.key === key));
}

export function groupKeyTaken(groups: CategoryGroupSetting[], key: string): boolean {
  return groups.some((group) => group.key === key);
}

/**
 * 순서 요청이 지금 구성과 정확히 같은 행들을 담는지 본다. 빠지거나 남는 행, 다른 종류로 옮긴 유형이
 * 있으면 거절한다(그 사이 다른 관리자가 바꿨을 수 있다).
 */
export function orderMatches(groups: CategoryGroupSetting[], order: OrderInput): boolean {
  if (order.groups.length !== groups.length) return false;
  const seenGroups = new Set<string>();
  for (const entry of order.groups) {
    const group = groups.find((candidate) => candidate.id === entry.id);
    if (!group || seenGroups.has(entry.id)) return false;
    seenGroups.add(entry.id);
    if (entry.typeIds.length !== group.types.length) return false;
    const ids = new Set(group.types.map((type) => type.id));
    const seenTypes = new Set<string>();
    for (const typeId of entry.typeIds) {
      if (!ids.has(typeId) || seenTypes.has(typeId)) return false;
      seenTypes.add(typeId);
    }
  }
  return true;
}

/** 순서를 0부터 다시 매겼을 때 값이 바뀌는 행만. */
export function planOrderUpdates(groups: CategoryGroupSetting[], order: OrderInput) {
  const groupUpdates: Array<{ id: string; sortOrder: number }> = [];
  const typeUpdates: Array<{ id: string; sortOrder: number }> = [];
  order.groups.forEach((entry, groupIndex) => {
    const group = groups.find((candidate) => candidate.id === entry.id)!;
    if (group.sortOrder !== groupIndex) groupUpdates.push({ id: group.id, sortOrder: groupIndex });
    entry.typeIds.forEach((typeId, typeIndex) => {
      const type = group.types.find((candidate) => candidate.id === typeId)!;
      if (type.sortOrder !== typeIndex) typeUpdates.push({ id: typeId, sortOrder: typeIndex });
    });
  });
  return { groupUpdates, typeUpdates };
}

export interface TypeReferences {
  inquiries: number;
  templates: number;
}

export interface GroupReferences {
  types: number;
  inquiries: number;
}

/** 지울 수 없는 이유. 없으면 null. */
export function typeDeleteBlocker(refs: TypeReferences): string | null {
  const reasons: string[] = [];
  if (refs.inquiries > 0) reasons.push(`이 유형으로 접수된 문의 ${refs.inquiries}건`);
  if (refs.templates > 0) reasons.push(`이 유형에 연결된 답변 템플릿 ${refs.templates}개`);
  if (reasons.length === 0) return null;
  const fixes: string[] = [];
  if (refs.inquiries > 0) fixes.push("문의는 유형 키로 남아 있어 유형을 지우면 문의함에서 유형 이름을 잃습니다.");
  if (refs.templates > 0) fixes.push("템플릿은 답변 템플릿 화면에서 다른 유형으로 바꾸거나 지워 주세요.");
  return `삭제할 수 없습니다 — 남아 있는 것: ${reasons.join(", ")}. ${fixes.join(" ")}`;
}

export function groupDeleteBlocker(refs: GroupReferences): string | null {
  if (refs.types > 0) return `유형 ${refs.types}개가 남아 있어 삭제할 수 없습니다. 유형을 다른 종류로 옮기거나 먼저 지워 주세요.`;
  if (refs.inquiries > 0) return `이 종류로 접수된 문의 ${refs.inquiries}건이 있어 삭제할 수 없습니다. 지우면 문의함에서 종류 이름을 잃습니다.`;
  return null;
}

export type MutationResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "key_taken" | "order_mismatch" | "in_use" | "save_failed"; message?: string };

function labelColumns(input: { labelKo: string; labelZh: string | null; labelEn: string | null }) {
  return { label_ko: input.labelKo, label_zh: input.labelZh, label_en: input.labelEn };
}

function typeColumns(input: TypeUpdateInput) {
  return {
    ...labelColumns(input),
    group_id: input.groupId,
    requires_game_account: input.requiresGameAccount,
    requires_company_name: input.requiresCompanyName,
    allow_attachments: input.allowAttachments,
    requires_attachments: input.allowAttachments && input.requiresAttachments,
    collects_payment_no: input.collectsPaymentNo,
    collects_occurred_at: input.collectsOccurredAt,
    collects_device_info: input.collectsDeviceInfo,
    collects_store: input.collectsStore,
    collects_character: input.collectsCharacter,
    default_priority: input.defaultPriority,
  };
}

export async function createGroup(supabase: SupabaseClient, gameId: string, input: GroupCreateInput): Promise<MutationResult> {
  const groups = await listGameCategorySettings(supabase, gameId);
  if (groupKeyTaken(groups, input.key)) return { ok: false, error: "key_taken" };

  const { error } = await supabase
    .from("inquiry_groups")
    .insert({ game_id: gameId, key: input.key, ...labelColumns(input), sort_order: nextSortOrder(groups) });
  return error ? { ok: false, error: "save_failed" } : { ok: true };
}

export async function updateGroup(supabase: SupabaseClient, gameId: string, groupId: string, input: GroupUpdateInput): Promise<MutationResult> {
  const groups = await listGameCategorySettings(supabase, gameId);
  if (!groups.some((group) => group.id === groupId)) return { ok: false, error: "not_found" };

  const { error } = await supabase.from("inquiry_groups").update(labelColumns(input)).eq("id", groupId).eq("game_id", gameId);
  return error ? { ok: false, error: "save_failed" } : { ok: true };
}

async function countRows(
  supabase: SupabaseClient,
  table: "inquiries" | "reply_templates",
  gameId: string,
  column: "type_key" | "group_key",
  key: string
): Promise<number | null> {
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).eq("game_id", gameId).eq(column, key);
  return error ? null : count ?? 0;
}

export async function deleteGroup(supabase: SupabaseClient, gameId: string, groupId: string): Promise<MutationResult> {
  const groups = await listGameCategorySettings(supabase, gameId);
  const group = groups.find((candidate) => candidate.id === groupId);
  if (!group) return { ok: false, error: "not_found" };

  const inquiries = group.types.length > 0 ? 0 : await countRows(supabase, "inquiries", gameId, "group_key", group.key);
  // 건수를 못 세면 지우지 않는다.
  if (inquiries === null) return { ok: false, error: "save_failed" };
  const blocker = groupDeleteBlocker({ types: group.types.length, inquiries });
  if (blocker) return { ok: false, error: "in_use", message: blocker };

  const { error } = await supabase.from("inquiry_groups").delete().eq("id", groupId).eq("game_id", gameId);
  return error ? { ok: false, error: "save_failed" } : { ok: true };
}

export async function createType(supabase: SupabaseClient, gameId: string, input: TypeCreateInput): Promise<MutationResult> {
  const groups = await listGameCategorySettings(supabase, gameId);
  const group = groups.find((candidate) => candidate.id === input.groupId);
  if (!group) return { ok: false, error: "not_found" };
  if (typeKeyTaken(groups, input.key)) return { ok: false, error: "key_taken" };

  const { error } = await supabase
    .from("inquiry_types")
    .insert({ ...typeColumns(input), key: input.key, sort_order: nextSortOrder(group.types) });
  return error ? { ok: false, error: "save_failed" } : { ok: true };
}

export async function updateType(supabase: SupabaseClient, gameId: string, typeId: string, input: TypeUpdateInput): Promise<MutationResult> {
  const groups = await listGameCategorySettings(supabase, gameId);
  const type = findType(groups, typeId);
  const target = groups.find((candidate) => candidate.id === input.groupId);
  if (!type || !target) return { ok: false, error: "not_found" };

  // 다른 종류로 옮기면 그 종류의 맨 뒤에 붙인다.
  const moved = type.groupId !== target.id;
  const { error } = await supabase
    .from("inquiry_types")
    .update({ ...typeColumns(input), ...(moved ? { sort_order: nextSortOrder(target.types) } : {}) })
    .eq("id", typeId);
  return error ? { ok: false, error: "save_failed" } : { ok: true };
}

export async function deleteType(supabase: SupabaseClient, gameId: string, typeId: string): Promise<MutationResult> {
  const groups = await listGameCategorySettings(supabase, gameId);
  const type = findType(groups, typeId);
  if (!type) return { ok: false, error: "not_found" };

  const [inquiries, templates] = await Promise.all([
    countRows(supabase, "inquiries", gameId, "type_key", type.key),
    countRows(supabase, "reply_templates", gameId, "type_key", type.key),
  ]);
  if (inquiries === null || templates === null) return { ok: false, error: "save_failed" };
  const blocker = typeDeleteBlocker({ inquiries, templates });
  if (blocker) return { ok: false, error: "in_use", message: blocker };

  const { error } = await supabase.from("inquiry_types").delete().eq("id", typeId);
  return error ? { ok: false, error: "save_failed" } : { ok: true };
}

export async function saveOrder(supabase: SupabaseClient, gameId: string, order: OrderInput): Promise<MutationResult> {
  const groups = await listGameCategorySettings(supabase, gameId);
  if (!orderMatches(groups, order)) return { ok: false, error: "order_mismatch" };

  const { groupUpdates, typeUpdates } = planOrderUpdates(groups, order);
  // 게임당 행이 열 개 남짓이라 한 행씩 고친다. upsert는 not null 열(label_ko)까지 보내야 해서 쓰지 않는다.
  const results = await Promise.all([
    ...groupUpdates.map((row) => supabase.from("inquiry_groups").update({ sort_order: row.sortOrder }).eq("id", row.id).eq("game_id", gameId)),
    ...typeUpdates.map((row) => supabase.from("inquiry_types").update({ sort_order: row.sortOrder }).eq("id", row.id)),
  ]);
  return results.some((result) => result.error) ? { ok: false, error: "save_failed" } : { ok: true };
}

/** 라우트가 돌려줄 HTTP 상태. */
export function mutationStatus(error: Exclude<MutationResult, { ok: true }>["error"]): number {
  if (error === "not_found") return 404;
  if (error === "save_failed") return 500;
  return 409;
}
