import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { EMBEDDING_MAX_CHARS, EMBEDDING_MODEL, inquiryEmbeddingText } from "@/lib/embeddings";

const require = createRequire(import.meta.url);
const script = require("../../scripts/backfill-inquiry-embeddings.js") as {
  embeddingText: (title: string, content: string) => string;
  EMBEDDING_MAX_CHARS: number;
  EMBEDDING_MODEL: string;
};

describe("backfill-inquiry-embeddings", () => {
  it("builds the same text as lib/embeddings so stored vectors are comparable", () => {
    const long = "가".repeat(EMBEDDING_MAX_CHARS + 50);
    expect(script.embeddingText(" 제목 ", "본문\n")).toBe(inquiryEmbeddingText({ title: " 제목 ", content: "본문\n" }));
    expect(script.embeddingText("제목", long)).toBe(inquiryEmbeddingText({ title: "제목", content: long }));
    expect(script.EMBEDDING_MAX_CHARS).toBe(EMBEDDING_MAX_CHARS);
    expect(script.EMBEDDING_MODEL).toBe(EMBEDDING_MODEL);
  });
});
