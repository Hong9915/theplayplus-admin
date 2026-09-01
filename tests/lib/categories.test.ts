import { describe, it, expect, vi } from "vitest";
import { DEFAULT_CATEGORY_TEMPLATE, createDefaultCategoriesForGame, listGames } from "@/lib/categories";

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
