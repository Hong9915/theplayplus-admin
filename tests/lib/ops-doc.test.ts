import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const filesCreate = vi.fn();
const batchUpdate = vi.fn();
const permissionsCreate = vi.fn();
const setCredentials = vi.fn();
vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: vi.fn(function () { return { setCredentials }; }),
      JWT: vi.fn(function () { return {}; }),
    },
    docs: vi.fn(() => ({ documents: { batchUpdate } })),
    drive: vi.fn(() => ({ files: { create: filesCreate }, permissions: { create: permissionsCreate } })),
  },
}));

import { OPS_DOC_SECTIONS, opsDocBody, opsDocTitle, opsDocEditors, createOpsDoc, isOpsDocConfigured } from "@/lib/ops-doc";
import { SheetError } from "@/lib/google-auth";

const SERVICE_EMAIL = "bot@example.iam.gserviceaccount.com";
const ACCOUNT = JSON.stringify({ client_email: SERVICE_EMAIL, private_key: "-----KEY-----" });

describe("opsDocBody", () => {
  it("names the game, lists every section, and carries no fact-like example lines", () => {
    const body = opsDocBody("여신 키우기");
    expect(body.startsWith("여신 키우기 운영 현황 (AI 답변 근거)")).toBe(true);
    for (const section of OPS_DOC_SECTIONS) expect(body).toContain(`# ${section}`);
    // "(예: 환불 승인 시 재화 회수)" 같은 예시를 모델이 사실로 옮겨 적었다(2026-09-14 실측).
    expect(body).not.toContain("(예:");
    expect(body).toContain("(아직 작성되지 않음)");
    expect(opsDocTitle("여신 키우기")).toBe("여신 키우기 운영 현황 (AI 답변 근거)");
  });
});

describe("opsDocEditors", () => {
  afterEach(() => { delete process.env.OPS_DOC_EDITORS; });

  it("merges the creator with OPS_DOC_EDITORS, trimming and de-duplicating", () => {
    process.env.OPS_DOC_EDITORS = " lead@theplayplus.com, admin@theplayplus.com ,,admin@theplayplus.com";
    expect(opsDocEditors("admin@theplayplus.com")).toEqual(["admin@theplayplus.com", "lead@theplayplus.com"]);
  });

  it("drops a creator that is not an email address (auth id fallback)", () => {
    expect(opsDocEditors("8f1c-uuid-without-at")).toEqual([]);
  });
});

describe("createOpsDoc", () => {
  beforeEach(() => {
    filesCreate.mockReset().mockResolvedValue({ data: { id: "doc-1" } });
    batchUpdate.mockReset().mockResolvedValue({});
    permissionsCreate.mockReset().mockResolvedValue({ data: { id: "perm-1" } });
    setCredentials.mockReset();
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = ACCOUNT;
    process.env.GOOGLE_DOCS_REFRESH_TOKEN = "rt-docs";
    process.env.GMAIL_CLIENT_ID = "cid";
    process.env.GMAIL_CLIENT_SECRET = "csecret";
  });
  afterEach(() => {
    for (const key of ["GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_DOCS_REFRESH_TOKEN", "GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "OPS_DOC_FOLDER_ID"]) delete process.env[key];
  });

  it("creates the doc as the OAuth user, writes the skeleton, and shares it with the service account first, then each editor", async () => {
    const result = await createOpsDoc({ gameName: "여신 키우기", editors: ["a@x.com", "b@x.com"] });

    // 서비스 계정은 Drive 용량이 0이라 소유할 수 없다. 발신 계정의 refresh token으로 만든다.
    expect(setCredentials).toHaveBeenCalledWith({ refresh_token: "rt-docs" });
    expect(filesCreate).toHaveBeenCalledWith({
      requestBody: { name: "여신 키우기 운영 현황 (AI 답변 근거)", mimeType: "application/vnd.google-apps.document" },
      fields: "id",
    });
    const update = batchUpdate.mock.calls[0][0];
    expect(update.documentId).toBe("doc-1");
    expect(update.requestBody.requests[0].insertText).toEqual({ location: { index: 1 }, text: opsDocBody("여신 키우기") });
    // 읽는 쪽이 먼저 공유돼야 자료 연결 직후 AI 추천이 읽을 수 있다.
    expect(permissionsCreate.mock.calls.map((call) => call[0].requestBody.emailAddress)).toEqual([SERVICE_EMAIL, "a@x.com", "b@x.com"]);
    expect(permissionsCreate.mock.calls[0][0]).toEqual({
      fileId: "doc-1",
      requestBody: { type: "user", role: "writer", emailAddress: SERVICE_EMAIL },
      sendNotificationEmail: false,
    });
    expect(result).toEqual({
      docId: "doc-1",
      title: "여신 키우기 운영 현황 (AI 답변 근거)",
      url: "https://docs.google.com/document/d/doc-1/edit",
      unshared: [],
    });
  });

  it("puts the doc under OPS_DOC_FOLDER_ID when set", async () => {
    process.env.OPS_DOC_FOLDER_ID = "folder-9";
    await createOpsDoc({ gameName: "G", editors: [] });
    expect(filesCreate.mock.calls[0][0].requestBody.parents).toEqual(["folder-9"]);
  });

  it("keeps the doc and reports editors it could not share with instead of throwing", async () => {
    permissionsCreate.mockRejectedValueOnce(new Error("no drive api"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await createOpsDoc({ gameName: "G", editors: ["a@x.com"] });

    expect(result.docId).toBe("doc-1");
    expect(result.unshared).toEqual([SERVICE_EMAIL]);
  });

  it("throws not_configured when the docs refresh token is missing", async () => {
    delete process.env.GOOGLE_DOCS_REFRESH_TOKEN;
    expect(isOpsDocConfigured()).toBe(false);
    await expect(createOpsDoc({ gameName: "G", editors: [] })).rejects.toMatchObject({ reason: "not_configured" });
    await expect(createOpsDoc({ gameName: "G", editors: [] })).rejects.toBeInstanceOf(SheetError);
    expect(filesCreate).not.toHaveBeenCalled();
  });
});
