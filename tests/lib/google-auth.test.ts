import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { google } from "googleapis";
import { googleAuth, GOOGLE_SCOPES } from "@/lib/google-auth";

vi.mock("googleapis", () => ({
  google: {
    auth: { JWT: vi.fn(function () { return {}; }) },
  },
}));

const jwtMock = vi.mocked(google.auth.JWT);

const CREDS = JSON.stringify({ client_email: "bot@proj.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n" });

describe("googleAuth", () => {
  beforeEach(() => {
    jwtMock.mockClear();
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = CREDS;
  });
  afterEach(() => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  });

  it("builds a JWT with both the spreadsheets and documents.readonly scopes", () => {
    googleAuth();
    expect(jwtMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "bot@proj.iam.gserviceaccount.com",
        key: expect.stringContaining("PRIVATE KEY"),
        scopes: expect.arrayContaining(["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/documents.readonly"]),
      })
    );
    expect(GOOGLE_SCOPES).toEqual(expect.arrayContaining(["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/documents.readonly"]));
  });

  it("throws not_configured without credentials", () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    expect(() => googleAuth()).toThrow();
  });
});
