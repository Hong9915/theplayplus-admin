import { describe, it, expect } from "vitest";
import { buildAccountTimeline, buildTimeline } from "@/lib/timeline";
import type { InquiryRow } from "@/lib/inquiries";
import type { MessageRow } from "@/lib/messages";
import type { NoteRow } from "@/lib/notes";

const inquiry: InquiryRow = {
  id: "inq-1",
  inquiryNo: "R-20260903-0007",
  gameId: "game-1",
  groupKey: "game_usage",
  typeKey: "payment_refund",
  gameAccount: "luna_park",
  companyName: null,
  replyEmail: "luna@example.com",
  title: "중복 결제",
  content: "두 번 결제됐어요",
  status: "in_progress",
  priority: "high",
  meta: {},
  draftReply: null,
  replyContent: null,
  repliedAt: null,
  gmailThreadId: "t1",
  unreadReplyAt: null,
  locale: null,
  translations: {},
  paymentNo: null,
  store: null,
  occurredAt: null,
  deviceInfo: null,
  createdAt: "2026-09-03T01:12:00.000Z",
};

const messages: MessageRow[] = [
  { id: "m-in", direction: "inbound", authorEmail: "luna@example.com", body: "감사합니다", gmailMessageId: "g2", rfcMessageId: null, sentAt: "2026-09-03T04:48:00.000Z", autoSent: false, translations: {} },
  { id: "m-out", direction: "outbound", authorEmail: "info@theplayplus.com", body: "환불 처리했습니다", gmailMessageId: "g1", rfcMessageId: "<a>", sentAt: "2026-09-03T02:05:00.000Z", autoSent: false, translations: {} },
];

const notes: NoteRow[] = [
  { id: "n-1", authorEmail: "hong@theplayplus.com", content: "중복 승인 확인", createdAt: "2026-09-03T01:40:00.000Z" },
];

describe("buildTimeline", () => {
  it("puts the inquiry body first and the rest in time order", () => {
    const attachments = [{ id: "a1", fileName: "명세서.png", signedUrl: "https://x/1" }];
    const entries = buildTimeline(inquiry, attachments, messages, notes);

    expect(entries.map((e) => e.kind)).toEqual(["inquiry", "note", "outbound", "inbound"]);
    expect(entries[0]).toEqual({
      kind: "inquiry",
      id: "inq-1",
      at: "2026-09-03T01:12:00.000Z",
      author: "luna_park",
      body: "두 번 결제됐어요",
      details: [],
      attachments,
      translations: {},
    });
    expect(entries[1]).toMatchObject({ kind: "note", id: "n-1", author: "hong@theplayplus.com", body: "중복 승인 확인" });
    // 메시지 항목은 번역 API가 필요로 하는 문의 id와 저장된 번역을 함께 싣는다.
    expect(entries[2]).toMatchObject({ kind: "outbound", id: "m-out", inquiryId: "inq-1", author: "info@theplayplus.com", translations: {} });
    expect(entries[3]).toMatchObject({ kind: "inbound", id: "m-in", inquiryId: "inq-1", author: "luna@example.com", translations: {} });
  });

  it("carries the type-specific detail rows on the inquiry entry", () => {
    const [head] = buildTimeline({ ...inquiry, occurredAt: "2026-09-02T21:00", store: "app_store", paymentNo: "imp_9" }, [], [], []);
    expect(head.kind).toBe("inquiry");
    if (head.kind !== "inquiry") throw new Error("fixture");
    expect(head.details.map((d) => [d.label, d.value])).toEqual([
      ["발생 일시", "2026. 09. 02. 오후 9:00"],
      ["스토어", "App Store"],
      ["결제번호", "imp_9"],
    ]);
  });

  it("flags outbound entries that were sent automatically", () => {
    const auto: MessageRow = { ...messages[1], id: "m-auto", authorEmail: null, autoSent: true, translations: {} };
    const entries = buildTimeline(inquiry, [], [auto, messages[1]], []);
    expect(entries[1]).toMatchObject({ kind: "outbound", id: "m-auto", auto: true, author: null });
    expect(entries[2]).toMatchObject({ kind: "outbound", id: "m-out", auto: false });
  });

  it("keeps the inquiry first even when a message predates createdAt", () => {
    const early: MessageRow = { ...messages[1], id: "m-early", sentAt: "2026-09-02T00:00:00.000Z" };
    const entries = buildTimeline(inquiry, [], [early], []);
    expect(entries.map((e) => e.id)).toEqual(["inq-1", "m-early"]);
  });

  it("is stable for equal timestamps (messages before notes as given)", () => {
    const same = "2026-09-03T02:05:00.000Z";
    const entries = buildTimeline(inquiry, [], [{ ...messages[1], sentAt: same }], [{ ...notes[0], createdAt: same }]);
    expect(entries.map((e) => e.id)).toEqual(["inq-1", "m-out", "n-1"]);
  });
});

describe("buildAccountTimeline", () => {
  const older = {
    inquiry: {
      id: "inq-0",
      inquiryNo: "R-20260721-0002",
      title: "예전 문의",
      content: "예전 본문",
      typeKey: "account_login",
      status: "resolved" as const,
      gameAccount: "luna_park",
      occurredAt: null,
      paymentNo: null,
      store: null,
      deviceInfo: null,
      translations: {},
      createdAt: "2026-07-21T00:00:00.000Z",
    },
    attachments: [],
    messages: [{ ...messages[1], id: "m-old", sentAt: "2026-07-21T01:00:00.000Z" }],
    notes: [],
  };
  const current = { inquiry, attachments: [], messages, notes };

  it("orders threads by inquiry time, adds a divider per thread, and marks the current one", () => {
    const entries = buildAccountTimeline([current, older], "inq-1");
    expect(entries.map((e) => `${e.kind}:${e.id}`)).toEqual([
      "divider:inq-0",
      "inquiry:inq-0",
      "outbound:m-old",
      "divider:inq-1",
      "inquiry:inq-1",
      "note:n-1",
      "outbound:m-out",
      "inbound:m-in",
    ]);
    expect(entries[0]).toMatchObject({ kind: "divider", inquiryNo: "R-20260721-0002", title: "예전 문의", typeKey: "account_login", status: "resolved", current: false });
    expect(entries[3]).toMatchObject({ kind: "divider", current: true });
  });

  it("omits dividers when there is a single thread", () => {
    const entries = buildAccountTimeline([current], "inq-1");
    expect(entries[0].kind).toBe("inquiry");
    expect(entries.some((e) => e.kind === "divider")).toBe(false);
  });
});
