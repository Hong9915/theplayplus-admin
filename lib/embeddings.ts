import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 문의 임베딩. AI 답변 추천이 "내용이 비슷한 과거 문의"를 찾는 근거다.
 *
 * 벡터는 inquiries.embedding에 저장하고, 어느 모델로 만들었는지
 * embedding_model에 남긴다. 모델을 바꾸면 값이 달라 그 문의만 다시 계산한다.
 */

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
/** 임베딩 입력 상한(글자). 한국어는 글자당 1토큰 가까이 쓰므로 8191토큰 상한의 절반 아래로 둔다. 백필 스크립트도 같은 값을 쓴다. */
export const EMBEDDING_MAX_CHARS = 4000;

export type EmbeddingErrorReason = "not_configured" | "failed";

export class EmbeddingError extends Error {
  constructor(public readonly reason: EmbeddingErrorReason) {
    super(reason);
    this.name = "EmbeddingError";
  }
}

/** 제목 + 빈 줄 + 본문. 상한을 넘으면 뒤를 자른다. */
export function inquiryEmbeddingText(inquiry: { title: string; content: string }): string {
  const text = `${inquiry.title.trim()}\n\n${inquiry.content.trim()}`;
  return text.length > EMBEDDING_MAX_CHARS ? text.slice(0, EMBEDDING_MAX_CHARS) : text;
}

export async function embedText(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new EmbeddingError("not_configured");

  try {
    const client = new OpenAI({ apiKey });
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
      dimensions: EMBEDDING_DIMENSIONS,
    });
    const vector = response.data[0]?.embedding;
    if (!vector || vector.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(`unexpected embedding shape: ${vector?.length ?? "none"}`);
    }
    return vector;
  } catch (error) {
    console.warn("[embeddings] OpenAI request failed", error);
    throw new EmbeddingError("failed");
  }
}

/** supabase-js는 vector 열을 "[0.1,0.2,…]" 문자열로 돌려준다. 배열이면 그대로. */
function parseStoredEmbedding(value: unknown): number[] | null {
  if (Array.isArray(value)) {
    return value.every((entry) => typeof entry === "number") ? (value as number[]) : null;
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as number[]) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 문의의 임베딩을 돌려준다. 저장된 것이 있고 모델이 같으면 그대로, 아니면 계산해
 * 저장한다. 어떤 실패도 null로 돌려준다 — 호출부(추천·발송)가 막히면 안 된다.
 */
export async function ensureInquiryEmbedding(
  supabase: SupabaseClient,
  inquiry: { id: string; title: string; content: string }
): Promise<number[] | null> {
  try {
    const { data } = await supabase
      .from("inquiries")
      .select("embedding, embedding_model")
      .eq("id", inquiry.id)
      .maybeSingle();

    if (data?.embedding_model === EMBEDDING_MODEL) {
      const stored = parseStoredEmbedding(data.embedding);
      if (stored) return stored;
    }

    const vector = await embedText(inquiryEmbeddingText(inquiry));

    const { error } = await supabase
      .from("inquiries")
      .update({ embedding: vector, embedding_model: EMBEDDING_MODEL })
      .eq("id", inquiry.id);
    if (error) {
      // 저장이 실패해도 이번 검색에는 쓸 수 있다.
      console.warn("[embeddings] failed to store inquiry embedding", error);
    }
    return vector;
  } catch (error) {
    // 키가 없는 건 설정 문제라 매번 경고할 필요가 없다.
    if (!(error instanceof EmbeddingError && error.reason === "not_configured")) {
      console.warn("[embeddings] ensureInquiryEmbedding failed", error);
    }
    return null;
  }
}
