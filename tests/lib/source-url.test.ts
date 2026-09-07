import { describe, it, expect, vi } from "vitest";

// 클라이언트 컴포넌트(ConversationSidebar)가 이 모듈을 값으로 import한다. 서버 전용
// 패키지(googleapis → net)가 딸려 오면 Next 클라이언트 번들이 깨지므로, 여기서는 그
// 패키지를 로드하는 순간 실패하게 해 두고 모듈이 홀로 서는지 확인한다.
vi.mock("googleapis", () => {
  throw new Error("googleapis must not be loaded by lib/source-url");
});

describe("lib/source-url", () => {
  it("loads without any server-only dependency", async () => {
    const mod = await import("@/lib/source-url");
    expect(typeof mod.parseSourceUrl).toBe("function");
    expect(typeof mod.sourceUrl).toBe("function");
  });

  it("parses and builds sheet and doc urls", async () => {
    const { parseSourceUrl, sourceUrl } = await import("@/lib/source-url");
    expect(parseSourceUrl("https://docs.google.com/spreadsheets/d/1AbC-_9/edit#gid=0")).toEqual({ kind: "sheet", externalId: "1AbC-_9" });
    expect(parseSourceUrl("https://docs.google.com/document/d/1DoC_x/edit")).toEqual({ kind: "doc", externalId: "1DoC_x" });
    expect(parseSourceUrl("1AbC-_9")).toBeNull();
    expect(sourceUrl({ kind: "doc", externalId: "1DoC" })).toBe("https://docs.google.com/document/d/1DoC/edit");
  });
});
