import { describe, it, expect } from "vitest";
import { readNdjson } from "@/lib/ndjson";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe("readNdjson", () => {
  it("yields one parsed object per line", async () => {
    const items = await collect(readNdjson(streamOf(['{"a":1}\n{"a":2}\n'])));
    expect(items).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("reassembles a line split across chunks", async () => {
    const items = await collect(readNdjson(streamOf(['{"text":"안녕', '하세요"}\n'])));
    expect(items).toEqual([{ text: "안녕하세요" }]);
  });

  it("handles a multi-byte character split across chunks", async () => {
    const bytes = new TextEncoder().encode('{"text":"한"}\n');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 10));
        controller.enqueue(bytes.slice(10));
        controller.close();
      },
    });
    expect(await collect(readNdjson(stream))).toEqual([{ text: "한" }]);
  });

  it("yields a trailing line without a newline", async () => {
    const items = await collect(readNdjson(streamOf(['{"a":1}\n{"a":2}'])));
    expect(items).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("skips blank lines", async () => {
    const items = await collect(readNdjson(streamOf(['{"a":1}\n\n\n{"a":2}\n'])));
    expect(items).toEqual([{ a: 1 }, { a: 2 }]);
  });
});
