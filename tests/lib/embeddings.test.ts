import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  EMBEDDING_MAX_CHARS,
  EMBEDDING_MODEL,
  EmbeddingError,
  embedText,
  ensureInquiryEmbedding,
  inquiryEmbeddingText,
} from "@/lib/embeddings";

const createMock = vi.fn();
vi.mock("openai", () => ({
  default: vi.fn(function () {
    return { embeddings: { create: createMock } };
  }),
}));

const VECTOR = Array.from({ length: 1536 }, (_, i) => i / 1536);

function mockSupabase(stored: { embedding: unknown; embedding_model: string | null } | null, updateError: { message: string } | null = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: stored, error: null });
  const eqSelect = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq: eqSelect }));
  const eqUpdate = vi.fn().mockResolvedValue({ error: updateError });
  const update = vi.fn(() => ({ eq: eqUpdate }));
  const from = vi.fn(() => ({ select, update }));
  return { supabase: { from } as never, from, select, update, eqUpdate };
}

describe("inquiryEmbeddingText", () => {
  it("joins the title and body with a blank line", () => {
    expect(inquiryEmbeddingText({ title: " 결제 오류 ", content: "다이아가 안 들어와요\n" })).toBe("결제 오류\n\n다이아가 안 들어와요");
  });

  it("cuts the text at the character limit", () => {
    const text = inquiryEmbeddingText({ title: "제목", content: "가".repeat(EMBEDDING_MAX_CHARS) });
    expect(text.length).toBe(EMBEDDING_MAX_CHARS);
  });
});

describe("embedText", () => {
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    createMock.mockReset();
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  it("throws not_configured without calling the SDK when the key is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(embedText("본문")).rejects.toMatchObject({ reason: "not_configured" });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("calls the embeddings API with the model and dimensions and returns the vector", async () => {
    createMock.mockResolvedValue({ data: [{ embedding: VECTOR }] });

    await expect(embedText("본문")).resolves.toEqual(VECTOR);
    expect(createMock).toHaveBeenCalledWith({ model: EMBEDDING_MODEL, input: "본문", dimensions: 1536 });
  });

  it("throws failed when the SDK throws", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createMock.mockRejectedValue(new Error("network down"));

    await expect(embedText("본문")).rejects.toBeInstanceOf(EmbeddingError);
    await expect(embedText("본문")).rejects.toMatchObject({ reason: "failed" });
    warnSpy.mockRestore();
  });

  it("throws failed when the response has the wrong shape", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createMock.mockResolvedValue({ data: [{ embedding: [1, 2, 3] }] });

    await expect(embedText("본문")).rejects.toMatchObject({ reason: "failed" });
    warnSpy.mockRestore();
  });
});

describe("ensureInquiryEmbedding", () => {
  const inquiry = { id: "inq-1", title: "결제 오류", content: "다이아가 안 들어와요" };
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    createMock.mockReset().mockResolvedValue({ data: [{ embedding: VECTOR }] });
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  it("reuses a stored vector made by the same model (supabase returns it as a string)", async () => {
    const { supabase, update } = mockSupabase({ embedding: JSON.stringify(VECTOR), embedding_model: EMBEDDING_MODEL });

    await expect(ensureInquiryEmbedding(supabase, inquiry)).resolves.toEqual(VECTOR);
    expect(createMock).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("computes and stores the vector when none is saved", async () => {
    const { supabase, from, update, eqUpdate } = mockSupabase({ embedding: null, embedding_model: null });

    await expect(ensureInquiryEmbedding(supabase, inquiry)).resolves.toEqual(VECTOR);
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ input: "결제 오류\n\n다이아가 안 들어와요" }));
    expect(from).toHaveBeenCalledWith("inquiries");
    expect(update).toHaveBeenCalledWith({ embedding: VECTOR, embedding_model: EMBEDDING_MODEL });
    expect(eqUpdate).toHaveBeenCalledWith("id", "inq-1");
  });

  it("recomputes when the stored vector came from another model", async () => {
    const { supabase, update } = mockSupabase({ embedding: JSON.stringify(VECTOR), embedding_model: "text-embedding-ada-002" });

    await ensureInquiryEmbedding(supabase, inquiry);
    expect(createMock).toHaveBeenCalled();
    expect(update).toHaveBeenCalled();
  });

  it("still returns the vector when saving it fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { supabase } = mockSupabase({ embedding: null, embedding_model: null }, { message: "db down" });

    await expect(ensureInquiryEmbedding(supabase, inquiry)).resolves.toEqual(VECTOR);
    warnSpy.mockRestore();
  });

  it("returns null instead of throwing when embedding fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createMock.mockRejectedValue(new Error("boom"));
    const { supabase } = mockSupabase({ embedding: null, embedding_model: null });

    await expect(ensureInquiryEmbedding(supabase, inquiry)).resolves.toBeNull();
    warnSpy.mockRestore();
  });

  it("returns null quietly when the key is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    const { supabase } = mockSupabase({ embedding: null, embedding_model: null });

    await expect(ensureInquiryEmbedding(supabase, inquiry)).resolves.toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });
});
