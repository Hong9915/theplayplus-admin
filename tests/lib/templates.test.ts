import { describe, it, expect, vi } from "vitest";
import { listTemplates, createTemplate, deleteTemplate } from "@/lib/templates";

const sampleRow = {
  id: "tpl-1",
  type_key: "payment_refund",
  title: "환불 안내",
  content: "환불 절차를 안내드립니다.",
};

function mockList(data: unknown, error: { message: string } | null = null) {
  const orderCreated = vi.fn().mockResolvedValue({ data, error });
  const orderSort = vi.fn(() => ({ order: orderCreated }));
  const eq = vi.fn(() => ({ order: orderSort }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from, eq, orderSort, orderCreated };
}

describe("listTemplates", () => {
  it("filters by game and orders by sort_order then created_at", async () => {
    const { from, eq, orderSort, orderCreated } = mockList([sampleRow]);

    const result = await listTemplates({ from } as never, "game-1");

    expect(from).toHaveBeenCalledWith("reply_templates");
    expect(eq).toHaveBeenCalledWith("game_id", "game-1");
    expect(orderSort).toHaveBeenCalledWith("sort_order", { ascending: true });
    expect(orderCreated).toHaveBeenCalledWith("created_at", { ascending: true });
    expect(result).toEqual([
      { id: "tpl-1", typeKey: "payment_refund", title: "환불 안내", content: "환불 절차를 안내드립니다." },
    ]);
  });

  it("keeps a null type_key as a shared template", async () => {
    const { from } = mockList([{ ...sampleRow, type_key: null }]);
    const result = await listTemplates({ from } as never, "game-1");
    expect(result[0].typeKey).toBeNull();
  });

  it("returns an empty array when the query errors", async () => {
    const { from } = mockList(null, { message: "db error" });
    await expect(listTemplates({ from } as never, "game-1")).resolves.toEqual([]);
  });
});

describe("createTemplate", () => {
  it("inserts the template and reports success", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn(() => ({ insert }));

    const ok = await createTemplate({ from } as never, {
      gameId: "game-1",
      typeKey: "payment_refund",
      title: "환불 안내",
      content: "환불 절차를 안내드립니다.",
    });

    expect(from).toHaveBeenCalledWith("reply_templates");
    expect(insert).toHaveBeenCalledWith({
      game_id: "game-1",
      type_key: "payment_refund",
      title: "환불 안내",
      content: "환불 절차를 안내드립니다.",
    });
    expect(ok).toBe(true);
  });

  it("passes a null type_key through unchanged", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn(() => ({ insert }));

    await createTemplate({ from } as never, {
      gameId: "game-1",
      typeKey: null,
      title: "공용",
      content: "본문",
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ type_key: null }));
  });

  it("reports failure instead of throwing", async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: "db error" } });
    const from = vi.fn(() => ({ insert }));

    const ok = await createTemplate({ from } as never, {
      gameId: "game-1",
      typeKey: null,
      title: "x",
      content: "y",
    });
    expect(ok).toBe(false);
  });
});

describe("deleteTemplate", () => {
  it("deletes by id and reports success", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const del = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ delete: del }));

    const ok = await deleteTemplate({ from } as never, "tpl-1");

    expect(eq).toHaveBeenCalledWith("id", "tpl-1");
    expect(ok).toBe(true);
  });

  it("reports failure instead of throwing", async () => {
    const eq = vi.fn().mockResolvedValue({ error: { message: "db error" } });
    const del = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ delete: del }));

    await expect(deleteTemplate({ from } as never, "tpl-1")).resolves.toBe(false);
  });
});
