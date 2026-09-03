import { describe, it, expect } from "vitest";
import { formatElapsed, formatReceivedAt, metaEntries, emailLocalPart, inquiryMetaRows } from "@/lib/format";
import type { InquiryRow } from "@/lib/inquiries";

const NOW = new Date("2026-07-23T12:00:00.000Z");

function minutesAgo(n: number): string {
  return new Date(NOW.getTime() - n * 60_000).toISOString();
}

describe("formatElapsed", () => {
  it("shows minutes under an hour", () => {
    expect(formatElapsed(minutesAgo(0), NOW)).toBe("0분");
    expect(formatElapsed(minutesAgo(59), NOW)).toBe("59분");
  });

  it("switches to hours at 60 minutes", () => {
    expect(formatElapsed(minutesAgo(60), NOW)).toBe("1시간");
    expect(formatElapsed(minutesAgo(60 * 23), NOW)).toBe("23시간");
  });

  it("switches to days at 24 hours", () => {
    expect(formatElapsed(minutesAgo(60 * 24), NOW)).toBe("1일");
    expect(formatElapsed(minutesAgo(60 * 24 * 3), NOW)).toBe("3일");
  });

  it("clamps a future timestamp to 0분", () => {
    expect(formatElapsed(new Date(NOW.getTime() + 60_000).toISOString(), NOW)).toBe("0분");
  });
});

describe("formatReceivedAt", () => {
  it("formats an afternoon time in Korean", () => {
    // 2026-07-23 22:55 KST
    expect(formatReceivedAt("2026-07-23T13:55:00.000Z")).toContain("2026. 07. 23.");
  });

  it("renders noon as 오후 12 and midnight as 오전 12", () => {
    const noon = new Date(2026, 6, 23, 12, 0).toISOString();
    const midnight = new Date(2026, 6, 23, 0, 0).toISOString();
    expect(formatReceivedAt(noon)).toBe("2026. 07. 23. 오후 12:00");
    expect(formatReceivedAt(midnight)).toBe("2026. 07. 23. 오전 12:00");
  });
});

describe("metaEntries", () => {
  it("returns an empty array for non-objects", () => {
    expect(metaEntries(null)).toEqual([]);
    expect(metaEntries(undefined)).toEqual([]);
    expect(metaEntries("uid")).toEqual([]);
    expect(metaEntries([1, 2])).toEqual([]);
    expect(metaEntries({})).toEqual([]);
  });

  it("labels known keys in a fixed order regardless of input order", () => {
    const result = metaEntries({ device: "SM-S938N", uid: "10024871", server: "kr-01" });
    expect(result).toEqual([
      { key: "uid", label: "UID", value: "10024871" },
      { key: "server", label: "서버", value: "kr-01" },
      { key: "device", label: "기기", value: "SM-S938N" },
    ]);
  });

  it("appends unknown keys after known ones, sorted by key", () => {
    const result = metaEntries({ zeta: "z", uid: "1", alpha: "a" });
    expect(result.map((entry) => entry.key)).toEqual(["uid", "alpha", "zeta"]);
    expect(result[1]).toEqual({ key: "alpha", label: "alpha", value: "a" });
  });

  it("drops null, undefined, and blank values", () => {
    const result = metaEntries({ uid: "1", server: null, nickname: "", platform: "   " });
    expect(result.map((entry) => entry.key)).toEqual(["uid"]);
  });

  it("stringifies object and number values", () => {
    const result = metaEntries({ uid: 10024871, extra: { a: 1 } });
    expect(result).toEqual([
      { key: "uid", label: "UID", value: "10024871" },
      { key: "extra", label: "extra", value: '{"a":1}' },
    ]);
  });
});

describe("emailLocalPart", () => {
  it("takes the part before the @", () => {
    expect(emailLocalPart("info@theplayplus.com")).toBe("info");
  });

  it("returns the input unchanged when there is no @", () => {
    expect(emailLocalPart("user-1")).toBe("user-1");
  });

  it("returns an empty string for empty input", () => {
    expect(emailLocalPart("")).toBe("");
  });
});

describe("inquiryMetaRows", () => {
  const base: InquiryRow = {
    id: "inq-1",
    inquiryNo: "R-20260723-0005",
    gameId: "game-1",
    groupKey: "game_usage",
    typeKey: "bug_report",
    gameAccount: "player1",
    companyName: null,
    replyEmail: "user@example.com",
    title: "제목",
    content: "본문",
    status: "new",
    priority: "normal",
    meta: { device: "iPhone 15", app_version: "2.4.1" },
    draftReply: null,
    replyContent: null,
    repliedAt: null,
    gmailThreadId: null,
    createdAt: "2026-07-23T13:55:00.000Z",
  };

  it("lists fixed rows with values, then meta entries in the known order", () => {
    const rows = inquiryMetaRows(base);
    expect(rows.map((r) => r.label)).toEqual(["게임 계정", "회신 이메일", "접수 시각", "앱 버전", "기기"]);
    expect(rows[0].value).toBe("player1");
  });

  it("skips empty fixed rows", () => {
    const rows = inquiryMetaRows({ ...base, gameAccount: "  ", meta: {} });
    expect(rows.map((r) => r.label)).toEqual(["회신 이메일", "접수 시각"]);
  });
});
