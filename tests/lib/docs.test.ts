import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { serializeDocument, readDocument } from "@/lib/docs";

const getMock = vi.fn();
vi.mock("googleapis", () => ({
  google: {
    auth: { JWT: vi.fn(function () { return {}; }) },
    docs: vi.fn(() => ({ documents: { get: getMock } })),
  },
}));

const CREDS = JSON.stringify({ client_email: "bot@proj.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n" });

function paragraph(text: string, extra: Record<string, unknown> = {}) {
  return { paragraph: { elements: [{ textRun: { content: text } }], ...extra } };
}

describe("serializeDocument", () => {
  it("joins paragraphs, marks headings and bullets, skips empty ones", () => {
    const text = serializeDocument({
      body: {
        content: [
          { sectionBreak: {} },
          paragraph("환불 정책\n", { paragraphStyle: { namedStyleType: "HEADING_1" } }),
          paragraph("\n"),
          paragraph("7일 이내 ", {}),
          { paragraph: { elements: [{ textRun: { content: "첫 결제만 " } }, { textRun: { content: "환불\n" } }], bullet: { listId: "l1" } } },
          paragraph("세부\n", { paragraphStyle: { namedStyleType: "HEADING_3" } }),
        ],
      },
    });
    expect(text).toBe("# 환불 정책\n7일 이내\n- 첫 결제만 환불\n### 세부");
  });

  it("renders tables as pipe rows and flattens cell newlines", () => {
    const text = serializeDocument({
      body: {
        content: [
          {
            table: {
              tableRows: [
                { tableCells: [{ content: [paragraph("코드\n")] }, { content: [paragraph("상태\n")] }] },
                { tableCells: [{ content: [paragraph("m6fu5sj\n")] }, { content: [paragraph("사용\n"), paragraph("09.01\n")] }] },
              ],
            },
          },
        ],
      },
    });
    expect(text).toBe("코드 | 상태\nm6fu5sj | 사용 09.01");
  });

  it("returns an empty string for a document without a body", () => {
    expect(serializeDocument({})).toBe("");
  });
});

describe("readDocument", () => {
  beforeEach(() => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = CREDS;
    getMock.mockReset();
  });
  afterEach(() => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  });

  it("throws not_configured without credentials", async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    await expect(readDocument("d1")).rejects.toMatchObject({ reason: "not_configured" });
  });

  it("returns the title and serialized text", async () => {
    getMock.mockResolvedValue({ data: { title: "운영 가이드", body: { content: [paragraph("안녕\n")] } } });
    expect(await readDocument("d1")).toEqual({ title: "운영 가이드", text: "안녕" });
    expect(getMock).toHaveBeenCalledWith({ documentId: "d1" });
  });

  it("falls back to the id as title and maps 403/404/other", async () => {
    getMock.mockResolvedValue({ data: { body: { content: [] } } });
    expect((await readDocument("d1")).title).toBe("d1");
    getMock.mockRejectedValueOnce({ code: 403 });
    await expect(readDocument("d1")).rejects.toMatchObject({ reason: "source_forbidden" });
    getMock.mockRejectedValueOnce({ code: 404 });
    await expect(readDocument("d1")).rejects.toMatchObject({ reason: "source_not_found" });
    getMock.mockRejectedValueOnce(new Error("boom"));
    await expect(readDocument("d1")).rejects.toMatchObject({ reason: "source_read_failed" });
  });
});
