import { describe, it, expect, vi } from "vitest";
import {
  listTemplates,
  createTemplate,
  deleteTemplate,
  findAutoReplyTemplate,
  setTemplateAutoSend,
  updateTemplate,
} from "@/lib/templates";

const sampleRow = {
  id: "tpl-1",
  type_key: "payment_refund",
  title: "환불 안내",
  content: "환불 절차를 안내드립니다.",
  auto_send: false,
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
      { id: "tpl-1", typeKey: "payment_refund", title: "환불 안내", content: "환불 절차를 안내드립니다.", autoSend: false },
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

/** 필터 메서드가 자기 자신을 돌려주고 await 하면 결과가 나오는 빌더. */
function chain(result: { data?: unknown; error?: { message: string } | null }) {
  const builder: Record<string, unknown> = {};
  for (const name of ["select", "update", "eq", "is"]) {
    builder[name] = vi.fn(() => builder);
  }
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return builder as Record<string, ReturnType<typeof vi.fn>> & { then: unknown };
}

describe("findAutoReplyTemplate", () => {
  const typed = { ...sampleRow, id: "tpl-typed", type_key: "refund", auto_send: true };
  const shared = { ...sampleRow, id: "tpl-shared", type_key: null, auto_send: true };

  it("prefers the template for the inquiry's type over the shared one", async () => {
    const builder = chain({ data: [shared, typed], error: null });
    const from = vi.fn(() => builder);

    const result = await findAutoReplyTemplate({ from } as never, "game-1", "refund");

    expect(from).toHaveBeenCalledWith("reply_templates");
    expect(builder.eq).toHaveBeenCalledWith("game_id", "game-1");
    expect(builder.eq).toHaveBeenCalledWith("auto_send", true);
    expect(result?.id).toBe("tpl-typed");
  });

  it("falls back to the shared template when the type has none", async () => {
    const builder = chain({ data: [shared, typed], error: null });
    const result = await findAutoReplyTemplate({ from: () => builder } as never, "game-1", "bug_report");
    expect(result?.id).toBe("tpl-shared");
  });

  it("returns null when nothing is enabled or the query fails", async () => {
    await expect(findAutoReplyTemplate({ from: () => chain({ data: [], error: null }) } as never, "g", "t")).resolves.toBeNull();
    await expect(
      findAutoReplyTemplate({ from: () => chain({ data: null, error: { message: "db" } }) } as never, "g", "t")
    ).resolves.toBeNull();
  });
});

describe("setTemplateAutoSend", () => {
  function mockTemplate(template: { game_id: string; type_key: string | null } | null) {
    const lookup = chain({ data: template, error: template ? null : { message: "not found" } });
    const clear = chain({ error: null });
    const set = chain({ error: null });
    // 호출 순서: 템플릿 조회 → (켤 때) 같은 유형 끄기 → 이 템플릿 갱신
    let call = 0;
    const from = vi.fn(() => {
      call += 1;
      if (call === 1) return lookup;
      if (call === 2) return clear;
      return set;
    });
    return { from, lookup, clear, set };
  }

  it("turns off the other auto template of the same type before enabling this one", async () => {
    const { from, clear, set } = mockTemplate({ game_id: "game-1", type_key: "refund" });

    const ok = await setTemplateAutoSend({ from } as never, "tpl-2", true);

    expect(ok).toBe(true);
    expect(clear.update).toHaveBeenCalledWith({ auto_send: false });
    expect(clear.eq).toHaveBeenCalledWith("game_id", "game-1");
    expect(clear.eq).toHaveBeenCalledWith("type_key", "refund");
    expect(set.update).toHaveBeenCalledWith({ auto_send: true });
    expect(set.eq).toHaveBeenCalledWith("id", "tpl-2");
  });

  it("matches a shared template's siblings with an is-null filter", async () => {
    const { from, clear } = mockTemplate({ game_id: "game-1", type_key: null });
    await setTemplateAutoSend({ from } as never, "tpl-2", true);
    expect(clear.is).toHaveBeenCalledWith("type_key", null);
  });

  it("only updates the row when turning auto send off", async () => {
    const { from, clear, set } = mockTemplate({ game_id: "game-1", type_key: "refund" });

    const ok = await setTemplateAutoSend({ from } as never, "tpl-2", false);

    expect(ok).toBe(true);
    expect(clear.update).toHaveBeenCalledWith({ auto_send: false });
    expect(clear.eq).toHaveBeenCalledWith("id", "tpl-2");
    expect(set.update).not.toHaveBeenCalled();
  });

  it("reports failure when the template does not exist", async () => {
    const { from } = mockTemplate(null);
    await expect(setTemplateAutoSend({ from } as never, "missing", true)).resolves.toBe(false);
  });
});

describe("updateTemplate", () => {
  it("updates title, content, and type by id and reports success", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));

    const ok = await updateTemplate({ from } as never, "tpl-1", { title: "새 제목", content: "새 본문", typeKey: "refund" });

    expect(from).toHaveBeenCalledWith("reply_templates");
    expect(update).toHaveBeenCalledWith({ title: "새 제목", content: "새 본문", type_key: "refund" });
    expect(eq).toHaveBeenCalledWith("id", "tpl-1");
    expect(ok).toBe(true);
  });

  it("passes a null type through to make the template shared", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    await updateTemplate({ from: () => ({ update }) } as never, "tpl-1", { title: "t", content: "c", typeKey: null });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ type_key: null }));
  });

  it("reports failure instead of throwing", async () => {
    const eq = vi.fn().mockResolvedValue({ error: { message: "db error" } });
    const update = vi.fn(() => ({ eq }));
    await expect(updateTemplate({ from: () => ({ update }) } as never, "tpl-1", { title: "t", content: "c", typeKey: null })).resolves.toBe(false);
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
