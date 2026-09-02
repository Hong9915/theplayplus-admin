/**
 * NDJSON(줄 단위 JSON) 응답 본문을 한 객체씩 내어준다.
 *
 * fetch 스트림은 줄 경계와 무관하게 잘려 오고, 한글은 한 글자가 여러 바이트라
 * 바이트 경계에서도 잘릴 수 있다. TextDecoder의 stream 모드가 후자를, 줄 버퍼가
 * 전자를 처리한다.
 */
export async function* readNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });

      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield JSON.parse(line);
        newline = buffer.indexOf("\n");
      }

      if (done) break;
    }

    const rest = buffer.trim();
    if (rest) yield JSON.parse(rest);
  } finally {
    reader.releaseLock();
  }
}
