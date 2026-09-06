import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseSheetUrl,
  detectHeader,
  serializeSheets,
  columnToA1,
  prepareProposal,
  validateProposal,
  readSpreadsheet,
  applyProposal,
  serviceAccountEmail,
  SheetError,
  type SheetTab,
} from "@/lib/sheets";

const getMock = vi.fn();
const batchGetMock = vi.fn();
const batchUpdateMock = vi.fn();
const appendMock = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    auth: { JWT: vi.fn(function () { return {}; }) },
    sheets: vi.fn(() => ({
      spreadsheets: {
        get: getMock,
        values: { batchGet: batchGetMock, batchUpdate: batchUpdateMock, append: appendMock },
      },
    })),
  },
}));

const CREDS = JSON.stringify({ client_email: "bot@proj.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n" });

const vip: SheetTab = {
  title: "VIP",
  header: ["이메일", "ID", "VIP 단계", "갱신일"],
  rows: [
    ["이메일", "ID", "VIP 단계", "갱신일"],
    ["a@x.com", "52009", "VIP5", "08.27"],
    ["b@x.com", "51989", "VIP3", "08.27"],
  ],
};

const notes: SheetTab = {
  title: "메모",
  header: null,
  rows: [["코드 목록"], [], ["m6fu5sj", "사용"]],
};

describe("parseSheetUrl", () => {
  it("extracts the id from a full url", () => {
    expect(parseSheetUrl("https://docs.google.com/spreadsheets/d/1AbC-_9/edit#gid=0")).toBe("1AbC-_9");
  });
  it("accepts a bare id", () => {
    expect(parseSheetUrl("  1AbC-_9 ")).toBe("1AbC-_9");
  });
  it("rejects other urls and empty input", () => {
    expect(parseSheetUrl("https://example.com/x")).toBeNull();
    expect(parseSheetUrl("")).toBeNull();
    expect(parseSheetUrl("a b")).toBeNull();
  });
});

describe("detectHeader", () => {
  it("uses the first row when every cell is non-empty and unique", () => {
    expect(detectHeader(["이메일", "ID"])).toEqual(["이메일", "ID"]);
  });
  it("treats a single non-empty cell as a header", () => {
    expect(detectHeader(["코드 목록"])).toEqual(["코드 목록"]);
  });
  it("returns null for empty, blank, or duplicate cells", () => {
    expect(detectHeader(undefined)).toBeNull();
    expect(detectHeader([])).toBeNull();
    expect(detectHeader(["이메일", ""])).toBeNull();
    expect(detectHeader(["ID", "ID"])).toBeNull();
  });
});

describe("serializeSheets", () => {
  it("renders header tabs as pipe tables with 1-based row numbers", () => {
    const text = serializeSheets([vip]);
    expect(text).toContain("## VIP");
    expect(text).toContain("행 | 이메일 | ID | VIP 단계 | 갱신일");
    expect(text).toContain("2 | a@x.com | 52009 | VIP5 | 08.27");
    expect(text).toContain("3 | b@x.com | 51989 | VIP3 | 08.27");
    expect(text).not.toContain("1 | 이메일");
  });
  it("renders header-less tabs as 행 | 내용 and skips blank rows", () => {
    const text = serializeSheets([notes]);
    expect(text).toContain("행 | 내용");
    expect(text).toContain("1 | 코드 목록");
    expect(text).toContain("3 | m6fu5sj 사용");
    expect(text).not.toContain("\n2 |");
  });
  it("replaces pipes and newlines inside cells", () => {
    const text = serializeSheets([{ title: "T", header: null, rows: [["a|b\nc"]] }]);
    expect(text).toContain("1 | a b c");
  });
});

describe("columnToA1", () => {
  it("converts 0-based indexes", () => {
    expect(columnToA1(0)).toBe("A");
    expect(columnToA1(25)).toBe("Z");
    expect(columnToA1(26)).toBe("AA");
    expect(columnToA1(27)).toBe("AB");
  });
});

describe("prepareProposal", () => {
  it("fills before from the sheet for a valid update", () => {
    const result = prepareProposal([vip], {
      kind: "update",
      sheet: "VIP",
      row: 3,
      updates: [{ column: "VIP 단계", before: "wrong", after: "VIP4" }],
    });
    expect(result).toEqual({
      kind: "update",
      sheet: "VIP",
      row: 3,
      updates: [{ column: "VIP 단계", before: "VIP3", after: "VIP4" }],
    });
  });
  it("rejects unknown tab, header-less tab, unknown column, bad row, empty updates", () => {
    const base = { kind: "update", sheet: "VIP", row: 2, updates: [{ column: "VIP 단계", before: "", after: "x" }] };
    expect(prepareProposal([vip], { ...base, sheet: "없음" })).toBeNull();
    expect(prepareProposal([vip, notes], { ...base, sheet: "메모" })).toBeNull();
    expect(prepareProposal([vip], { ...base, updates: [{ column: "없는열", before: "", after: "x" }] })).toBeNull();
    expect(prepareProposal([vip], { ...base, row: 1 })).toBeNull();
    expect(prepareProposal([vip], { ...base, row: 4 })).toBeNull();
    expect(prepareProposal([vip], { ...base, updates: [] })).toBeNull();
    expect(prepareProposal([vip], null)).toBeNull();
    expect(prepareProposal([vip], { kind: "delete" })).toBeNull();
  });
  it("accepts append with known columns only", () => {
    expect(prepareProposal([vip], { kind: "append", sheet: "VIP", values: { 이메일: "c@x.com", ID: "1" } })).toEqual({
      kind: "append",
      sheet: "VIP",
      values: { 이메일: "c@x.com", ID: "1" },
    });
    expect(prepareProposal([vip], { kind: "append", sheet: "VIP", values: { 없는열: "x" } })).toBeNull();
    expect(prepareProposal([vip], { kind: "append", sheet: "VIP", values: {} })).toBeNull();
  });
  it("coerces numeric values to strings", () => {
    const result = prepareProposal([vip], { kind: "append", sheet: "VIP", values: { ID: 52009 } });
    expect(result).toEqual({ kind: "append", sheet: "VIP", values: { ID: "52009" } });
  });
});

describe("validateProposal", () => {
  it("passes when the sheet still matches before", () => {
    expect(
      validateProposal([vip], { kind: "update", sheet: "VIP", row: 2, updates: [{ column: "VIP 단계", before: " VIP5 ", after: "VIP6" }] })
    ).toEqual({ ok: true });
  });
  it("reports conflict when the cell changed", () => {
    expect(
      validateProposal([vip], { kind: "update", sheet: "VIP", row: 2, updates: [{ column: "VIP 단계", before: "VIP4", after: "VIP6" }] })
    ).toEqual({ ok: false, reason: "conflict" });
  });
  it("reports invalid_proposal for structural problems", () => {
    expect(validateProposal([vip], { kind: "append", sheet: "메모", values: { a: "b" } })).toEqual({ ok: false, reason: "invalid_proposal" });
  });
});

describe("service account", () => {
  afterEach(() => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  });
  it("returns the client_email, or null when unset or malformed", () => {
    expect(serviceAccountEmail()).toBeNull();
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = "{not json";
    expect(serviceAccountEmail()).toBeNull();
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = CREDS;
    expect(serviceAccountEmail()).toBe("bot@proj.iam.gserviceaccount.com");
  });
  it("readSpreadsheet throws not_configured without credentials", async () => {
    await expect(readSpreadsheet("s1")).rejects.toMatchObject({ reason: "not_configured" });
  });
});

describe("readSpreadsheet", () => {
  beforeEach(() => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = CREDS;
    getMock.mockReset();
    batchGetMock.mockReset();
  });
  afterEach(() => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  });

  it("reads every tab in one batchGet and detects headers", async () => {
    getMock.mockResolvedValue({ data: { sheets: [{ properties: { title: "VIP" } }, { properties: { title: "메모" } }] } });
    batchGetMock.mockResolvedValue({
      data: {
        valueRanges: [
          { values: [["이메일", "ID"], ["a@x.com", 52009]] },
          { values: [["코드 목록", ""], ["m6fu5sj"]] },
        ],
      },
    });

    const tabs = await readSpreadsheet("s1");

    expect(getMock).toHaveBeenCalledWith({ spreadsheetId: "s1", fields: "sheets.properties.title" });
    expect(batchGetMock).toHaveBeenCalledWith({ spreadsheetId: "s1", ranges: ["'VIP'", "'메모'"] });
    expect(tabs).toEqual([
      { title: "VIP", header: ["이메일", "ID"], rows: [["이메일", "ID"], ["a@x.com", "52009"]] },
      { title: "메모", header: null, rows: [["코드 목록", ""], ["m6fu5sj"]] },
    ]);
  });

  it("returns an empty list for a spreadsheet without tabs", async () => {
    getMock.mockResolvedValue({ data: { sheets: [] } });
    expect(await readSpreadsheet("s1")).toEqual([]);
    expect(batchGetMock).not.toHaveBeenCalled();
  });

  it("maps 403/404 and other failures to reasons", async () => {
    getMock.mockRejectedValueOnce({ code: 403 });
    await expect(readSpreadsheet("s1")).rejects.toMatchObject({ reason: "sheet_forbidden" });
    getMock.mockRejectedValueOnce({ code: 404 });
    await expect(readSpreadsheet("s1")).rejects.toMatchObject({ reason: "sheet_not_found" });
    getMock.mockRejectedValueOnce(new Error("boom"));
    await expect(readSpreadsheet("s1")).rejects.toMatchObject({ reason: "sheet_read_failed" });
  });

  it("throws sheet_too_large past the cap", async () => {
    getMock.mockResolvedValue({ data: { sheets: [{ properties: { title: "T" } }] } });
    batchGetMock.mockResolvedValue({ data: { valueRanges: [{ values: [["x".repeat(300_001)]] }] } });
    await expect(readSpreadsheet("s1")).rejects.toMatchObject({ reason: "sheet_too_large" });
  });
});

describe("applyProposal", () => {
  beforeEach(() => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = CREDS;
    getMock.mockReset().mockResolvedValue({ data: { sheets: [{ properties: { title: "VIP" } }] } });
    batchGetMock.mockReset().mockResolvedValue({
      data: { valueRanges: [{ values: [["이메일", "ID", "VIP 단계", "갱신일"], ["a@x.com", "52009", "VIP5", "08.27"]] }] },
    });
    batchUpdateMock.mockReset().mockResolvedValue({});
    appendMock.mockReset().mockResolvedValue({});
  });
  afterEach(() => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  });

  it("writes each updated cell by A1 range", async () => {
    await applyProposal("s1", {
      kind: "update",
      sheet: "VIP",
      row: 2,
      updates: [
        { column: "VIP 단계", before: "VIP5", after: "VIP6" },
        { column: "갱신일", before: "08.27", after: "09.04" },
      ],
    });
    expect(batchUpdateMock).toHaveBeenCalledWith({
      spreadsheetId: "s1",
      requestBody: {
        valueInputOption: "RAW",
        data: [
          { range: "'VIP'!C2", values: [["VIP6"]] },
          { range: "'VIP'!D2", values: [["09.04"]] },
        ],
      },
    });
  });

  it("appends a row ordered by the header, blank for missing columns", async () => {
    await applyProposal("s1", { kind: "append", sheet: "VIP", values: { ID: "1", 이메일: "c@x.com" } });
    expect(appendMock).toHaveBeenCalledWith({
      spreadsheetId: "s1",
      range: "'VIP'!A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [["c@x.com", "1", "", ""]] },
    });
  });

  it("throws conflict when the sheet changed since the proposal", async () => {
    await expect(
      applyProposal("s1", { kind: "update", sheet: "VIP", row: 2, updates: [{ column: "VIP 단계", before: "VIP4", after: "VIP6" }] })
    ).rejects.toMatchObject({ reason: "conflict" });
    expect(batchUpdateMock).not.toHaveBeenCalled();
  });

  it("throws sheet_write_failed when the API rejects", async () => {
    batchUpdateMock.mockRejectedValue(new Error("quota"));
    await expect(
      applyProposal("s1", { kind: "update", sheet: "VIP", row: 2, updates: [{ column: "VIP 단계", before: "VIP5", after: "VIP6" }] })
    ).rejects.toBeInstanceOf(SheetError);
    await expect(
      applyProposal("s1", { kind: "update", sheet: "VIP", row: 2, updates: [{ column: "VIP 단계", before: "VIP5", after: "VIP6" }] })
    ).rejects.toMatchObject({ reason: "sheet_write_failed" });
  });
});
