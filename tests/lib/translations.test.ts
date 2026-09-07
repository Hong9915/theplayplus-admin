import { describe, it, expect, vi } from "vitest";
import { parseTranslations, saveTranslation, isTranslationLang } from "@/lib/translations";

describe("parseTranslations", () => {
  it("keeps only known languages with string values", () => {
    expect(parseTranslations({ ko: "안녕", zh: "你好", en: "hi", ja: 3 })).toEqual({ ko: "안녕", zh: "你好" });
  });

  it("returns an empty object for null, arrays and non-objects", () => {
    expect(parseTranslations(null)).toEqual({});
    expect(parseTranslations(undefined)).toEqual({});
    expect(parseTranslations([])).toEqual({});
    expect(parseTranslations("ko")).toEqual({});
  });
});

describe("isTranslationLang", () => {
  it("accepts ko and zh only", () => {
    expect(isTranslationLang("ko")).toBe(true);
    expect(isTranslationLang("zh")).toBe(true);
    expect(isTranslationLang("en")).toBe(false);
    expect(isTranslationLang(1)).toBe(false);
  });
});

function fakeTable(existing: unknown, updateError: { message: string } | null = null) {
  const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: updateError }) }));
  const single = vi.fn().mockResolvedValue({ data: { translations: existing }, error: null });
  const select = vi.fn(() => ({ eq: vi.fn(() => ({ single })) }));
  return { from: vi.fn(() => ({ select, update })), update };
}

describe("saveTranslation", () => {
  it("merges the new language into the inquiry's existing translations", async () => {
    const table = fakeTable({ zh: "你好" });

    const saved = await saveTranslation(table as never, { kind: "inquiry", id: "inq-1" }, "ko", "안녕");

    expect(saved).toBe(true);
    expect(table.from).toHaveBeenCalledWith("inquiries");
    expect(table.update).toHaveBeenCalledWith({ translations: { zh: "你好", ko: "안녕" } });
  });

  it("writes message translations to inquiry_messages", async () => {
    const table = fakeTable(null);

    await saveTranslation(table as never, { kind: "message", id: "m-1" }, "zh", "你好");

    expect(table.from).toHaveBeenCalledWith("inquiry_messages");
    expect(table.update).toHaveBeenCalledWith({ translations: { zh: "你好" } });
  });

  it("returns false when the update fails", async () => {
    const table = fakeTable({}, { message: "boom" });
    await expect(saveTranslation(table as never, { kind: "inquiry", id: "inq-1" }, "ko", "안녕")).resolves.toBe(false);
  });
});
