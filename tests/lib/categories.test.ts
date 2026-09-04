import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_CATEGORY_TEMPLATE,
  createDefaultCategoriesForGame,
  listCategoryLabels,
  listCategoryLabelsForScope,
  listGames,
  listServiceCategoryLabels,
} from "@/lib/categories";
import { SERVICE_SCOPE, gameScope } from "@/lib/inbox-scope";

describe("DEFAULT_CATEGORY_TEMPLATE", () => {
  it("defines three groups in order with the expected type counts", () => {
    expect(DEFAULT_CATEGORY_TEMPLATE.map((g) => g.key)).toEqual(["account_security", "game_usage", "payment_refund"]);
    expect(DEFAULT_CATEGORY_TEMPLATE[0].types.map((t) => t.key)).toEqual(["account_inquiry", "account_restriction"]);
    expect(DEFAULT_CATEGORY_TEMPLATE[1].types.map((t) => t.key)).toEqual([
      "suggestion",
      "game_content",
      "bug_report",
      "restore_request",
      "install_connect",
      "event_inquiry",
    ]);
    expect(DEFAULT_CATEGORY_TEMPLATE[2].types.map((t) => t.key)).toEqual(["payment", "refund"]);
  });

  it("carries the per-type form flags the contact form reads", () => {
    const byKey = Object.fromEntries(DEFAULT_CATEGORY_TEMPLATE.flatMap((g) => g.types.map((t) => [t.key, t])));
    expect(byKey.install_connect).toMatchObject({ requiresAttachments: true, collectsDeviceInfo: true });
    expect(byKey.payment).toMatchObject({ collectsOccurredAt: true, collectsPaymentNo: false });
    expect(byKey.refund).toMatchObject({ collectsOccurredAt: true, collectsPaymentNo: true });
    expect(byKey.bug_report).toMatchObject({ requiresGameAccount: true, allowAttachments: true, requiresAttachments: false });
  });

  it("every group and type has a Korean, Chinese, and English label", () => {
    for (const group of DEFAULT_CATEGORY_TEMPLATE) {
      expect(group.labelKo).toBeTruthy();
      expect(group.labelZh).toBeTruthy();
      expect(group.labelEn).toBeTruthy();
      for (const type of group.types) {
        expect(type.labelKo).toBeTruthy();
        expect(type.labelZh).toBeTruthy();
        expect(type.labelEn).toBeTruthy();
      }
    }
  });
});

describe("createDefaultCategoriesForGame", () => {
  function buildSupabaseMock() {
    const groupInsertResults = [{ id: "group-1" }, { id: "group-2" }, { id: "group-3" }];
    let groupCall = 0;

    const groupsSingle = vi.fn(() => Promise.resolve({ data: groupInsertResults[groupCall++], error: null }));
    const groupsSelect = vi.fn(() => ({ single: groupsSingle }));
    const groupsInsert = vi.fn(() => ({ select: groupsSelect }));

    const typesInsert = vi.fn((_rows: unknown[]) => Promise.resolve({ error: null }));

    const from = vi.fn((table: string) => {
      if (table === "inquiry_groups") return { insert: groupsInsert };
      if (table === "inquiry_types") return { insert: typesInsert };
      throw new Error(`unexpected table: ${table}`);
    });

    return { from, groupsInsert, typesInsert };
  }

  it("creates one inquiry_groups row per template group, linked to the game", async () => {
    const supabase = buildSupabaseMock();
    await createDefaultCategoriesForGame(supabase as never, "game-abc");

    expect(supabase.groupsInsert).toHaveBeenCalledTimes(3);
    expect(supabase.groupsInsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ game_id: "game-abc", key: "account_security" })
    );
  });

  it("creates inquiry_types rows scoped to the inserted group id", async () => {
    const supabase = buildSupabaseMock();
    await createDefaultCategoriesForGame(supabase as never, "game-abc");

    expect(supabase.typesInsert).toHaveBeenCalledTimes(3);
    const firstGroupTypes = supabase.typesInsert.mock.calls[0][0];
    expect(firstGroupTypes).toHaveLength(2);
    expect(firstGroupTypes[0]).toEqual(
      expect.objectContaining({ group_id: "group-1", key: "account_inquiry", requires_game_account: true })
    );
    const gameUsageTypes = supabase.typesInsert.mock.calls[1][0] as Array<Record<string, unknown>>;
    expect(gameUsageTypes.find((row) => row.key === "install_connect")).toEqual(
      expect.objectContaining({ requires_attachments: true, collects_device_info: true, collects_payment_no: false })
    );
  });

  it("throws if a group insert fails", async () => {
    const from = vi.fn(() => ({
      insert: () => ({
        select: () => ({ single: () => Promise.resolve({ data: null, error: { message: "db error" } }) }),
      }),
    }));
    await expect(createDefaultCategoriesForGame({ from } as never, "game-abc")).rejects.toThrow(/account_security/);
  });
});

describe("default priority per type", () => {
  it("marks payment/refund/restore urgent, suggestion low, and everything else normal", () => {
    const priorities = Object.fromEntries(
      DEFAULT_CATEGORY_TEMPLATE.flatMap((g) => g.types.map((t) => [t.key, t.defaultPriority]))
    );
    const urgent = ["payment", "refund", "restore_request"];
    for (const [key, priority] of Object.entries(priorities)) {
      const expected = urgent.includes(key) ? "urgent" : key === "suggestion" ? "low" : "normal";
      expect(priority, key).toBe(expected);
    }
  });

  it("writes default_priority on inserted inquiry_types rows", async () => {
    const groupsSingle = vi.fn(() => Promise.resolve({ data: { id: "group-1" }, error: null }));
    const groupsInsert = vi.fn(() => ({ select: () => ({ single: groupsSingle }) }));
    const typesInsert = vi.fn((_rows: unknown[]) => Promise.resolve({ error: null }));
    const from = vi.fn((table: string) => {
      if (table === "inquiry_groups") return { insert: groupsInsert };
      if (table === "inquiry_types") return { insert: typesInsert };
      throw new Error(`unexpected table: ${table}`);
    });

    await createDefaultCategoriesForGame({ from } as never, "game-abc");

    const gameUsageTypes = typesInsert.mock.calls[1][0] as Array<Record<string, unknown>>;
    const paymentTypes = typesInsert.mock.calls[2][0] as Array<Record<string, unknown>>;
    expect(paymentTypes.find((row) => row.key === "refund")).toEqual(expect.objectContaining({ default_priority: "urgent" }));
    expect(gameUsageTypes.find((row) => row.key === "suggestion")).toEqual(expect.objectContaining({ default_priority: "low" }));
    expect(gameUsageTypes.find((row) => row.key === "bug_report")).toEqual(expect.objectContaining({ default_priority: "normal" }));
  });
});

describe("listGames", () => {
  it("maps snake_case rows to GameRow", async () => {
    const order = vi.fn(() =>
      Promise.resolve({
        data: [
          {
            id: "game-1",
            name: "여신키우기",
            status: "active",
            logo_path: "game-1/logo.png",
            owner_name: "홍길동",
            created_at: "2026-01-01T00:00:00.000Z",
          },
        ],
        error: null,
      })
    );
    const select = vi.fn(() => ({ order }));
    const from = vi.fn(() => ({ select }));

    const games = await listGames({ from } as never);
    expect(games).toEqual([
      {
        id: "game-1",
        name: "여신키우기",
        status: "active",
        logoPath: "game-1/logo.png",
        ownerName: "홍길동",
        createdAt: "2026-01-01T00:00:00.000Z",
        sheetId: null,
      },
    ]);
  });

  it("throws on a query error", async () => {
    const order = vi.fn(() => Promise.resolve({ data: null, error: { message: "db error" } }));
    const select = vi.fn(() => ({ order }));
    const from = vi.fn(() => ({ select }));

    await expect(listGames({ from } as never)).rejects.toThrow(/db error/);
  });
});

describe("listGames sheetId", () => {
  it("maps sheet_id to sheetId and defaults to null", async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        { id: "g1", name: "A", status: "active", logo_path: null, owner_name: null, created_at: "2026-01-01T00:00:00Z", sheet_id: "abc123" },
        { id: "g2", name: "B", status: "active", logo_path: null, owner_name: null, created_at: "2026-01-01T00:00:00Z", sheet_id: null },
      ],
      error: null,
    });
    const select = vi.fn(() => ({ order }));
    const from = vi.fn(() => ({ select }));

    const games = await listGames({ from } as never);

    expect(games[0].sheetId).toBe("abc123");
    expect(games[1].sheetId).toBeNull();
  });
});

describe("listCategoryLabels", () => {
  function chain(result: { data: unknown; error: null }) {
    const builder: Record<string, unknown> = {};
    for (const name of ["eq", "in", "order"]) {
      builder[name] = vi.fn(() => builder);
    }
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return builder;
  }

  it("returns labels plus type keys ordered by group then type sort_order", async () => {
    const groups = chain({
      data: [
        { id: "g-a", key: "game_usage", label_ko: "게임 이용 문의" },
        { id: "g-b", key: "business", label_ko: "사업 제휴 문의" },
      ],
      error: null,
    });
    const types = chain({
      data: [
        { key: "publishing", label_ko: "퍼블리싱", group_id: "g-b" },
        { key: "account_login", label_ko: "계정/로그인", group_id: "g-a" },
        { key: "bug_report", label_ko: "버그", group_id: "g-a" },
      ],
      error: null,
    });
    const from = vi.fn((table: string) => ({
      select: vi.fn(() => (table === "inquiry_groups" ? groups : types)),
    }));

    const labels = await listCategoryLabels({ from } as never, "game-1");

    expect(labels.groupLabels).toEqual({ game_usage: "게임 이용 문의", business: "사업 제휴 문의" });
    expect(labels.typeLabels.bug_report).toBe("버그");
    // DB가 sort_order로 정렬해 준 순서를 그룹 순서로 다시 묶는다.
    expect(labels.typeOrder).toEqual(["account_login", "bug_report", "publishing"]);
    expect(groups.order).toHaveBeenCalledWith("sort_order", { ascending: true });
    expect(types.order).toHaveBeenCalledWith("sort_order", { ascending: true });
  });

  it("returns empty maps and order when there are no groups", async () => {
    const groups = chain({ data: [], error: null });
    const from = vi.fn(() => ({ select: vi.fn(() => groups) }));
    await expect(listCategoryLabels({ from } as never, "game-1")).resolves.toEqual({
      groupLabels: {},
      typeLabels: {},
      typeOrder: [],
    });
  });
});

describe("listServiceCategoryLabels", () => {
  function chain(result: { data: unknown; error: { message: string } | null }) {
    const builder: Record<string, unknown> = {};
    for (const name of ["eq", "in", "order"]) {
      builder[name] = vi.fn(() => builder);
    }
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return builder;
  }

  it("reads the global service groups and types in sort order", async () => {
    const groups = chain({
      data: [
        { id: "sg-1", key: "business", label_ko: "사업 제휴 문의" },
        { id: "sg-2", key: "other", label_ko: "기타 문의" },
      ],
      error: null,
    });
    const types = chain({
      data: [
        { key: "publishing", label_ko: "퍼블리싱 제휴", group_id: "sg-1" },
        { key: "press", label_ko: "언론·보도 문의", group_id: "sg-2" },
        { key: "marketing", label_ko: "마케팅 제휴", group_id: "sg-1" },
      ],
      error: null,
    });
    const from = vi.fn((table: string) => ({
      select: vi.fn(() => (table === "service_groups" ? groups : types)),
    }));

    const labels = await listServiceCategoryLabels({ from } as never);

    expect(from).toHaveBeenCalledWith("service_groups");
    expect(from).toHaveBeenCalledWith("service_types");
    expect(groups.eq).not.toHaveBeenCalled();
    expect(labels.groupLabels).toEqual({ business: "사업 제휴 문의", other: "기타 문의" });
    expect(labels.typeLabels.press).toBe("언론·보도 문의");
    expect(labels.typeOrder).toEqual(["publishing", "marketing", "press"]);
    expect(types.in).toHaveBeenCalledWith("group_id", ["sg-1", "sg-2"]);
  });

  it("returns empty maps when the groups query fails", async () => {
    const groups = chain({ data: null, error: { message: "boom" } });
    const from = vi.fn(() => ({ select: vi.fn(() => groups) }));
    await expect(listServiceCategoryLabels({ from } as never)).resolves.toEqual({ groupLabels: {}, typeLabels: {}, typeOrder: [] });
  });
});

describe("listCategoryLabelsForScope", () => {
  it("reads inquiry_groups for a game and service_groups for the service scope", async () => {
    const tables: string[] = [];
    const empty = () => {
      const builder: Record<string, unknown> = {};
      for (const name of ["eq", "in", "order"]) builder[name] = vi.fn(() => builder);
      builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
      return builder;
    };
    const from = vi.fn((table: string) => {
      tables.push(table);
      return { select: vi.fn(() => empty()) };
    });

    await listCategoryLabelsForScope({ from } as never, gameScope("game-1"));
    await listCategoryLabelsForScope({ from } as never, SERVICE_SCOPE);

    expect(tables).toEqual(["inquiry_groups", "service_groups"]);
  });
});
