import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_REPLY_TEMPLATES,
  DEFAULT_RESOLUTION_TEMPLATES,
  createDefaultTemplatesForGame,
  seedResolutionTemplatesForGame,
} from "@/lib/default-templates";
import { DEFAULT_CATEGORY_TEMPLATE } from "@/lib/categories";

describe("DEFAULT_REPLY_TEMPLATES", () => {
  it("covers every type in the default category template exactly once", () => {
    const typeKeys = DEFAULT_CATEGORY_TEMPLATE.flatMap((group) => group.types.map((type) => type.key)).sort();
    const templateKeys = DEFAULT_REPLY_TEMPLATES.map((template) => template.typeKey).sort();
    expect(templateKeys).toEqual(typeKeys);
  });

  it("has a title and body for each template", () => {
    for (const template of DEFAULT_REPLY_TEMPLATES) {
      expect(template.title.length).toBeGreaterThan(0);
      expect(template.content.length).toBeGreaterThan(20);
    }
  });
});

describe("DEFAULT_RESOLUTION_TEMPLATES", () => {
  it("covers every type once, as answer examples for the AI suggestion", () => {
    const typeKeys = DEFAULT_CATEGORY_TEMPLATE.flatMap((group) => group.types.map((type) => type.key)).sort();
    expect(DEFAULT_RESOLUTION_TEMPLATES.map((template) => template.typeKey).sort()).toEqual(typeKeys);
  });

  it("follows the reply structure: no greeting, blank-line paragraphs, a next-step promise", () => {
    for (const template of DEFAULT_RESOLUTION_TEMPLATES) {
      // 메일 템플릿이 "OOO님, 안녕하세요."를 붙이므로 본문은 인사 없이 시작한다.
      expect(template.content.startsWith("안녕하세요")).toBe(false);
      expect(template.content.split("\n\n").length).toBeGreaterThanOrEqual(3);
      expect(template.content).toMatch(/겠습니다/);
      expect(template.title).not.toContain("접수 안내");
    }
  });
});

describe("createDefaultTemplatesForGame", () => {
  it("also inserts the resolution templates with auto-send off, after the intake ones", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    await createDefaultTemplatesForGame({ from: () => ({ insert }) } as never, "game-9");

    const rows = insert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(DEFAULT_REPLY_TEMPLATES.length + DEFAULT_RESOLUTION_TEMPLATES.length);
    const resolution = rows.slice(DEFAULT_REPLY_TEMPLATES.length);
    expect(resolution.every((row) => row.auto_send === false)).toBe(true);
    expect(resolution[0]).toEqual(
      expect.objectContaining({ type_key: "payment", sort_order: DEFAULT_REPLY_TEMPLATES.length })
    );
  });


  it("inserts one auto-send template per type, ordered as defined", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn(() => ({ insert }));

    await createDefaultTemplatesForGame({ from } as never, "game-9");

    expect(from).toHaveBeenCalledWith("reply_templates");
    const rows = insert.mock.calls[0][0] as Array<Record<string, unknown>>;
    const intake = rows.slice(0, DEFAULT_REPLY_TEMPLATES.length);
    expect(rows[0]).toEqual(
      expect.objectContaining({ game_id: "game-9", type_key: "payment", auto_send: true, sort_order: 0 })
    );
    expect(intake.every((row) => row.auto_send === true)).toBe(true);
  });

  it("throws with the database message when the insert fails", async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: "db error" } });
    await expect(createDefaultTemplatesForGame({ from: () => ({ insert }) } as never, "game-9")).rejects.toThrow(/db error/);
  });
});

describe("seedResolutionTemplatesForGame", () => {
  it("inserts only the resolution templates the game does not have yet, by title", async () => {
    const existing = [{ title: DEFAULT_RESOLUTION_TEMPLATES[0].title }, { title: "관리자가 만든 것" }];
    const eq = vi.fn().mockResolvedValue({ data: existing, error: null });
    const select = vi.fn(() => ({ eq }));
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn(() => ({ select, insert }));

    const added = await seedResolutionTemplatesForGame({ from } as never, "game-9");

    expect(eq).toHaveBeenCalledWith("game_id", "game-9");
    expect(added).toBe(DEFAULT_RESOLUTION_TEMPLATES.length - 1);
    const rows = insert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(DEFAULT_RESOLUTION_TEMPLATES.length - 1);
    expect(rows.map((row) => row.title)).not.toContain(DEFAULT_RESOLUTION_TEMPLATES[0].title);
    expect(rows.every((row) => row.auto_send === false && row.game_id === "game-9")).toBe(true);
  });

  it("inserts nothing and returns 0 when every resolution template already exists", async () => {
    const eq = vi.fn().mockResolvedValue({ data: DEFAULT_RESOLUTION_TEMPLATES.map((t) => ({ title: t.title })), error: null });
    const insert = vi.fn();
    const from = vi.fn(() => ({ select: () => ({ eq }), insert }));

    await expect(seedResolutionTemplatesForGame({ from } as never, "game-9")).resolves.toBe(0);
    expect(insert).not.toHaveBeenCalled();
  });
});
