import { describe, it, expect, vi } from "vitest";
import { DEFAULT_REPLY_TEMPLATES, createDefaultTemplatesForGame } from "@/lib/default-templates";
import { DEFAULT_CATEGORY_TEMPLATE } from "@/lib/categories";

describe("DEFAULT_REPLY_TEMPLATES", () => {
  it("covers every type in the default category template exactly once", () => {
    const typeKeys = DEFAULT_CATEGORY_TEMPLATE.flatMap((group) => group.types.map((type) => type.key)).sort();
    const templateKeys = DEFAULT_REPLY_TEMPLATES.map((template) => template.typeKey).sort();
    expect(templateKeys).toEqual(typeKeys);
  });

  it("has a title and body for each template and never repeats the email greeting", () => {
    for (const template of DEFAULT_REPLY_TEMPLATES) {
      expect(template.title.length).toBeGreaterThan(0);
      expect(template.content.length).toBeGreaterThan(20);
      // 메일 템플릿이 "안녕하세요"를 이미 붙이므로 본문에 또 들어가면 두 번 인사한다.
      expect(template.content).not.toContain("안녕하세요");
    }
  });
});

describe("createDefaultTemplatesForGame", () => {
  it("inserts one auto-send template per type, ordered as defined", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn(() => ({ insert }));

    await createDefaultTemplatesForGame({ from } as never, "game-9");

    expect(from).toHaveBeenCalledWith("reply_templates");
    const rows = insert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(DEFAULT_REPLY_TEMPLATES.length);
    expect(rows[0]).toEqual(
      expect.objectContaining({ game_id: "game-9", type_key: "payment", auto_send: true, sort_order: 0 })
    );
    expect(rows.every((row) => row.auto_send === true)).toBe(true);
  });

  it("throws with the database message when the insert fails", async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: "db error" } });
    await expect(createDefaultTemplatesForGame({ from: () => ({ insert }) } as never, "game-9")).rejects.toThrow(/db error/);
  });
});
