import { describe, it, expect, vi } from "vitest";
import { DEFAULT_CATEGORY_TEMPLATE, createDefaultCategoriesForGame, listCategoryLabels, listGames } from "@/lib/categories";

describe("DEFAULT_CATEGORY_TEMPLATE", () => {
  it("defines three groups in order with the expected type counts", () => {
    expect(DEFAULT_CATEGORY_TEMPLATE.map((g) => g.key)).toEqual(["game_usage", "business", "other"]);
    expect(DEFAULT_CATEGORY_TEMPLATE[0].types).toHaveLength(4);
    expect(DEFAULT_CATEGORY_TEMPLATE[1].types).toHaveLength(2);
    expect(DEFAULT_CATEGORY_TEMPLATE[2].types).toHaveLength(2);
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
      expect.objectContaining({ game_id: "game-abc", key: "game_usage" })
    );
  });

  it("creates inquiry_types rows scoped to the inserted group id", async () => {
    const supabase = buildSupabaseMock();
    await createDefaultCategoriesForGame(supabase as never, "game-abc");

    expect(supabase.typesInsert).toHaveBeenCalledTimes(3);
    const firstGroupTypes = supabase.typesInsert.mock.calls[0][0];
    expect(firstGroupTypes).toHaveLength(4);
    expect(firstGroupTypes[0]).toEqual(
      expect.objectContaining({ group_id: "group-1", key: "account_login", requires_game_account: true })
    );
  });

  it("throws if a group insert fails", async () => {
    const from = vi.fn(() => ({
      insert: () => ({
        select: () => ({ single: () => Promise.resolve({ data: null, error: { message: "db error" } }) }),
      }),
    }));
    await expect(createDefaultCategoriesForGame({ from } as never, "game-abc")).rejects.toThrow(/game_usage/);
  });
});

describe("default priority per type", () => {
  it("marks payment/refund as urgent and every other template type as normal", () => {
    const priorities = Object.fromEntries(
      DEFAULT_CATEGORY_TEMPLATE.flatMap((g) => g.types.map((t) => [t.key, t.defaultPriority]))
    );
    expect(priorities.payment_refund).toBe("urgent");
    for (const [key, priority] of Object.entries(priorities)) {
      if (key !== "payment_refund") expect(priority).toBe("normal");
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

    const firstGroupTypes = typesInsert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(firstGroupTypes.find((row) => row.key === "payment_refund")).toEqual(
      expect.objectContaining({ default_priority: "urgent" })
    );
    expect(firstGroupTypes.find((row) => row.key === "bug_report")).toEqual(
      expect.objectContaining({ default_priority: "normal" })
    );
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
