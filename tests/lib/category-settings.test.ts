import { describe, it, expect } from "vitest";
import {
  createGroup,
  createType,
  deleteGroup,
  deleteType,
  groupCreateSchema,
  groupDeleteBlocker,
  listGameCategorySettings,
  orderMatches,
  planOrderUpdates,
  saveOrder,
  typeCreateSchema,
  typeDeleteBlocker,
  typeUpdateSchema,
  updateType,
  type CategoryGroupSetting,
} from "@/lib/category-settings";

const FLAGS = {
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

function typeRow(id: string, groupId: string, key: string, sortOrder: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    group_id: groupId,
    key,
    label_ko: key,
    label_zh: null,
    label_en: null,
    requires_game_account: true,
    requires_company_name: false,
    allow_attachments: true,
    requires_attachments: false,
    collects_payment_no: false,
    collects_occurred_at: false,
    collects_device_info: false,
    collects_store: true,
    collects_character: false,
    default_priority: "normal",
    sort_order: sortOrder,
    ...extra,
  };
}

/**
 * 테스트용 Supabase. select는 표의 행을 eq/in 조건으로 걸러 돌려주고, head count는 counts에서,
 * insert/update/delete는 writes에 남긴다.
 */
function fakeSupabase(options: {
  groups: Array<Record<string, unknown>>;
  types: Array<Record<string, unknown>>;
  counts?: Record<string, number>;
  writeError?: boolean;
}) {
  const writes: Array<{ table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> }> = [];
  const tables: Record<string, Array<Record<string, unknown>>> = { inquiry_groups: options.groups, inquiry_types: options.types };

  function from(table: string) {
    const filters: Array<[string, unknown]> = [];
    const inFilters: Array<[string, unknown[]]> = [];
    let op = "select";
    let payload: unknown;
    let head = false;
    const builder = {
      select(_columns: string, opts?: { head?: boolean }) {
        head = opts?.head === true;
        return builder;
      },
      eq(column: string, value: unknown) {
        filters.push([column, value]);
        return builder;
      },
      in(column: string, values: unknown[]) {
        inFilters.push([column, values]);
        return builder;
      },
      insert(value: unknown) {
        op = "insert";
        payload = value;
        return builder;
      },
      update(value: unknown) {
        op = "update";
        payload = value;
        return builder;
      },
      delete() {
        op = "delete";
        return builder;
      },
      then(resolve: (value: unknown) => void) {
        if (op !== "select") {
          writes.push({ table, op, payload, filters });
          resolve({ error: options.writeError ? { message: "boom" } : null });
          return;
        }
        if (head) {
          const key = `${table}:${filters.map(([c, v]) => `${c}=${v}`).join("&")}`;
          resolve({ count: options.counts?.[key] ?? 0, error: null });
          return;
        }
        const rows = (tables[table] ?? []).filter(
          (row) => filters.every(([c, v]) => row[c] === v) && inFilters.every(([c, values]) => values.includes(row[c]))
        );
        resolve({ data: rows, error: null });
      },
    };
    return builder;
  }

  return { client: { from } as never, writes };
}

const GROUPS = [
  { id: "g-pay", game_id: "game-1", key: "payment_refund", label_ko: "결제/환불", label_zh: null, label_en: null, sort_order: 1 },
  { id: "g-acc", game_id: "game-1", key: "account_security", label_ko: "계정/보안", label_zh: null, label_en: null, sort_order: 0 },
  { id: "g-other", game_id: "game-2", key: "account_security", label_ko: "다른 게임", label_zh: null, label_en: null, sort_order: 0 },
];
const TYPES = [
  typeRow("t-refund", "g-pay", "refund", 1, { collects_payment_no: true, default_priority: "urgent" }),
  typeRow("t-pay", "g-pay", "payment", 0),
  typeRow("t-acc", "g-acc", "account_inquiry", 0),
  typeRow("t-other", "g-other", "account_inquiry", 0),
];

describe("schemas", () => {
  it("accepts snake_case keys and rejects anything else", () => {
    expect(groupCreateSchema.safeParse({ key: "coupon_2", labelKo: "쿠폰" }).success).toBe(true);
    for (const key of ["Coupon", "2coupon", "coupon-x", "쿠폰", "", "a b"]) {
      expect(groupCreateSchema.safeParse({ key, labelKo: "쿠폰" }).success).toBe(false);
    }
  });

  it("stores empty translations as null", () => {
    const parsed = groupCreateSchema.parse({ key: "coupon", labelKo: " 쿠폰 ", labelZh: "  ", labelEn: "Coupon" });
    expect(parsed).toEqual({ key: "coupon", labelKo: "쿠폰", labelZh: null, labelEn: "Coupon" });
  });

  it("requires a Korean label", () => {
    expect(groupCreateSchema.safeParse({ key: "coupon", labelKo: "  " }).success).toBe(false);
  });

  it("refuses 첨부 필수 without 첨부 허용", () => {
    const base = { groupId: "g", labelKo: "환불", ...FLAGS, defaultPriority: "normal" };
    const bad = typeUpdateSchema.safeParse({ ...base, allowAttachments: false, requiresAttachments: true });
    expect(bad.success).toBe(false);
    expect(bad.success ? [] : bad.error.issues.map((issue) => issue.path[0])).toContain("requiresAttachments");
    expect(typeUpdateSchema.safeParse({ ...base, allowAttachments: true, requiresAttachments: true }).success).toBe(true);
  });

  it("requires every flag and a known priority on create", () => {
    const { collectsCharacter: _c, ...missing } = FLAGS;
    expect(typeCreateSchema.safeParse({ groupId: "g", key: "x", labelKo: "x", ...missing, defaultPriority: "normal" }).success).toBe(false);
    expect(typeCreateSchema.safeParse({ groupId: "g", key: "x", labelKo: "x", ...FLAGS, defaultPriority: "asap" }).success).toBe(false);
  });

  it("does not let a type update carry a key", () => {
    const parsed = typeUpdateSchema.parse({ groupId: "g", key: "renamed", labelKo: "x", ...FLAGS, defaultPriority: "low" });
    expect("key" in parsed).toBe(false);
  });
});

describe("listGameCategorySettings", () => {
  it("returns only this game's groups and types, sorted", async () => {
    const { client } = fakeSupabase({ groups: GROUPS, types: TYPES });
    const groups = await listGameCategorySettings(client, "game-1");
    expect(groups.map((g) => g.key)).toEqual(["account_security", "payment_refund"]);
    expect(groups[1].types.map((t) => t.key)).toEqual(["payment", "refund"]);
    expect(groups[1].types[1]).toMatchObject({ collectsPaymentNo: true, defaultPriority: "urgent" });
    expect(groups.flatMap((g) => g.types).some((t) => t.id === "t-other")).toBe(false);
  });
});

function settings(): CategoryGroupSetting[] {
  const type = (id: string, groupId: string, key: string, sortOrder: number) => ({
    id,
    groupId,
    key,
    labelKo: key,
    labelZh: null,
    labelEn: null,
    ...FLAGS,
    defaultPriority: "normal" as const,
    sortOrder,
  });
  return [
    { id: "a", key: "a", labelKo: "A", labelZh: null, labelEn: null, sortOrder: 0, types: [type("a1", "a", "a1", 0), type("a2", "a", "a2", 1)] },
    { id: "b", key: "b", labelKo: "B", labelZh: null, labelEn: null, sortOrder: 1, types: [type("b1", "b", "b1", 5)] },
  ];
}

describe("order", () => {
  it("accepts exactly the current rows", () => {
    expect(orderMatches(settings(), { groups: [{ id: "b", typeIds: ["b1"] }, { id: "a", typeIds: ["a2", "a1"] }] })).toBe(true);
  });

  it("rejects missing, duplicated, extra or moved rows", () => {
    expect(orderMatches(settings(), { groups: [{ id: "a", typeIds: ["a1", "a2"] }] })).toBe(false);
    expect(orderMatches(settings(), { groups: [{ id: "a", typeIds: ["a1", "a1"] }, { id: "b", typeIds: ["b1"] }] })).toBe(false);
    expect(orderMatches(settings(), { groups: [{ id: "a", typeIds: ["a1", "a2", "x"] }, { id: "b", typeIds: ["b1"] }] })).toBe(false);
    expect(orderMatches(settings(), { groups: [{ id: "a", typeIds: ["a1", "b1"] }, { id: "b", typeIds: ["a2"] }] })).toBe(false);
    expect(orderMatches(settings(), { groups: [{ id: "a", typeIds: ["a1", "a2"] }, { id: "a", typeIds: ["a1", "a2"] }] })).toBe(false);
  });

  it("only rewrites rows whose position changed", () => {
    const plan = planOrderUpdates(settings(), { groups: [{ id: "b", typeIds: ["b1"] }, { id: "a", typeIds: ["a1", "a2"] }] });
    expect(plan.groupUpdates).toEqual([
      { id: "b", sortOrder: 0 },
      { id: "a", sortOrder: 1 },
    ]);
    // b1은 5였으므로 0으로 다시 매긴다. a1·a2는 그대로.
    expect(plan.typeUpdates).toEqual([{ id: "b1", sortOrder: 0 }]);
  });
});

describe("delete blockers", () => {
  it("allows deleting an unused type", () => {
    expect(typeDeleteBlocker({ inquiries: 0, templates: 0 })).toBeNull();
  });

  it("explains what still uses a type", () => {
    const message = typeDeleteBlocker({ inquiries: 3, templates: 2 })!;
    expect(message).toContain("문의 3건");
    expect(message).toContain("답변 템플릿 2개");
  });

  it("blocks a group with types or inquiries", () => {
    expect(groupDeleteBlocker({ types: 2, inquiries: 0 })).toContain("유형 2개");
    expect(groupDeleteBlocker({ types: 0, inquiries: 4 })).toContain("문의 4건");
    expect(groupDeleteBlocker({ types: 0, inquiries: 0 })).toBeNull();
  });
});

describe("mutations", () => {
  it("refuses a group key the game already has", async () => {
    const { client, writes } = fakeSupabase({ groups: GROUPS, types: TYPES });
    const result = await createGroup(client, "game-1", { key: "payment_refund", labelKo: "x", labelZh: null, labelEn: null });
    expect(result).toEqual({ ok: false, error: "key_taken" });
    expect(writes).toHaveLength(0);
  });

  it("appends a new group at the end", async () => {
    const { client, writes } = fakeSupabase({ groups: GROUPS, types: TYPES });
    expect(await createGroup(client, "game-1", { key: "event", labelKo: "이벤트", labelZh: null, labelEn: "Event" })).toEqual({ ok: true });
    expect(writes[0]).toMatchObject({ table: "inquiry_groups", op: "insert", payload: { game_id: "game-1", key: "event", label_en: "Event", sort_order: 2 } });
  });

  it("refuses a type key used in any group of the same game, but not another game's", async () => {
    const { client, writes } = fakeSupabase({ groups: GROUPS, types: TYPES });
    const input = { groupId: "g-acc", key: "refund", labelKo: "x", labelZh: null, labelEn: null, ...FLAGS, defaultPriority: "normal" as const };
    expect(await createType(client, "game-1", input)).toEqual({ ok: false, error: "key_taken" });
    expect(writes).toHaveLength(0);
  });

  it("refuses to add a type to another game's group", async () => {
    const { client } = fakeSupabase({ groups: GROUPS, types: TYPES });
    const input = { groupId: "g-other", key: "fresh", labelKo: "x", labelZh: null, labelEn: null, ...FLAGS, defaultPriority: "normal" as const };
    expect(await createType(client, "game-1", input)).toEqual({ ok: false, error: "not_found" });
  });

  it("creates a type with every form flag and the priority", async () => {
    const { client, writes } = fakeSupabase({ groups: GROUPS, types: TYPES });
    const input = {
      groupId: "g-pay",
      key: "coupon",
      labelKo: "쿠폰",
      labelZh: null,
      labelEn: null,
      ...FLAGS,
      collectsCharacter: true,
      collectsOccurredAt: true,
      defaultPriority: "high" as const,
    };
    expect(await createType(client, "game-1", input)).toEqual({ ok: true });
    expect(writes[0].payload).toMatchObject({
      group_id: "g-pay",
      key: "coupon",
      collects_character: true,
      collects_occurred_at: true,
      collects_store: true,
      requires_game_account: true,
      default_priority: "high",
      sort_order: 2,
    });
  });

  it("keeps the key and moves a type to the end of its new group", async () => {
    const { client, writes } = fakeSupabase({ groups: GROUPS, types: TYPES });
    const input = { groupId: "g-acc", labelKo: "결제", labelZh: null, labelEn: null, ...FLAGS, defaultPriority: "urgent" as const };
    expect(await updateType(client, "game-1", "t-pay", input)).toEqual({ ok: true });
    expect(writes[0].payload).toMatchObject({ group_id: "g-acc", sort_order: 1 });
    expect(writes[0].payload).not.toHaveProperty("key");
  });

  it("does not touch sort order when the group stays", async () => {
    const { client, writes } = fakeSupabase({ groups: GROUPS, types: TYPES });
    const input = { groupId: "g-pay", labelKo: "결제", labelZh: null, labelEn: null, ...FLAGS, defaultPriority: "urgent" as const };
    await updateType(client, "game-1", "t-pay", input);
    expect(writes[0].payload).not.toHaveProperty("sort_order");
  });

  it("refuses to edit another game's type", async () => {
    const { client } = fakeSupabase({ groups: GROUPS, types: TYPES });
    const input = { groupId: "g-acc", labelKo: "x", labelZh: null, labelEn: null, ...FLAGS, defaultPriority: "normal" as const };
    expect(await updateType(client, "game-1", "t-other", input)).toEqual({ ok: false, error: "not_found" });
  });

  it("blocks deleting a type that inquiries or templates still use", async () => {
    const { client, writes } = fakeSupabase({
      groups: GROUPS,
      types: TYPES,
      counts: { "inquiries:game_id=game-1&type_key=refund": 7, "reply_templates:game_id=game-1&type_key=refund": 1 },
    });
    const result = await deleteType(client, "game-1", "t-refund");
    expect(result).toMatchObject({ ok: false, error: "in_use" });
    expect(result.ok ? "" : result.message).toContain("문의 7건");
    expect(writes).toHaveLength(0);
  });

  it("deletes an unused type", async () => {
    const { client, writes } = fakeSupabase({ groups: GROUPS, types: TYPES });
    expect(await deleteType(client, "game-1", "t-refund")).toEqual({ ok: true });
    expect(writes).toEqual([{ table: "inquiry_types", op: "delete", payload: undefined, filters: [["id", "t-refund"]] }]);
  });

  it("blocks deleting a group that still has types", async () => {
    const { client, writes } = fakeSupabase({ groups: GROUPS, types: TYPES });
    expect(await deleteGroup(client, "game-1", "g-acc")).toMatchObject({ ok: false, error: "in_use" });
    expect(writes).toHaveLength(0);
  });

  it("blocks deleting an empty group that past inquiries were filed under", async () => {
    const { client } = fakeSupabase({
      groups: GROUPS,
      types: TYPES.filter((t) => t.group_id !== "g-acc"),
      counts: { "inquiries:game_id=game-1&group_key=account_security": 2 },
    });
    expect(await deleteGroup(client, "game-1", "g-acc")).toMatchObject({ ok: false, error: "in_use" });
  });

  it("deletes an empty, unused group of this game only", async () => {
    const { client, writes } = fakeSupabase({ groups: GROUPS, types: TYPES.filter((t) => t.group_id !== "g-acc") });
    expect(await deleteGroup(client, "game-1", "g-acc")).toEqual({ ok: true });
    expect(writes[0]).toMatchObject({ table: "inquiry_groups", op: "delete", filters: [["id", "g-acc"], ["game_id", "game-1"]] });
    expect(await deleteGroup(client, "game-1", "g-other")).toEqual({ ok: false, error: "not_found" });
  });

  it("rejects an order that does not match, and saves only changed rows", async () => {
    const { client, writes } = fakeSupabase({ groups: GROUPS, types: TYPES });
    expect(await saveOrder(client, "game-1", { groups: [{ id: "g-acc", typeIds: ["t-acc"] }] })).toEqual({ ok: false, error: "order_mismatch" });
    expect(
      await saveOrder(client, "game-1", {
        groups: [
          { id: "g-acc", typeIds: ["t-acc"] },
          { id: "g-pay", typeIds: ["t-refund", "t-pay"] },
        ],
      })
    ).toEqual({ ok: true });
    expect(writes.map((w) => [w.table, w.payload, w.filters[0][1]])).toEqual([
      ["inquiry_types", { sort_order: 0 }, "t-refund"],
      ["inquiry_types", { sort_order: 1 }, "t-pay"],
    ]);
  });

  it("reports a failed write", async () => {
    const { client } = fakeSupabase({ groups: GROUPS, types: TYPES, writeError: true });
    expect(await deleteType(client, "game-1", "t-refund")).toEqual({ ok: false, error: "save_failed" });
  });
});
