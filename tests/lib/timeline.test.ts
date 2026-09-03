import { describe, it, expect } from "vitest";
import { buildTimeline } from "@/lib/timeline";
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
  createdAt: "2026-09-03T01:12:00.000Z",
};

const messages: MessageRow[] = [
  { id: "m-in", direction: "inbound", authorEmail: "luna@example.com", body: "감사합니다", gmailMessageId: "g2", rfcMessageId: null, sentAt: "2026-09-03T04:48:00.000Z" },
  { id: "m-out", direction: "outbound", authorEmail: "info@theplayplus.com", body: "환불 처리했습니다", gmailMessageId: "g1", rfcMessageId: "<a>", sentAt: "2026-09-03T02:05:00.000Z" },
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
      attachments,
    });
    expect(entries[1]).toMatchObject({ kind: "note", id: "n-1", author: "hong@theplayplus.com", body: "중복 승인 확인" });
    expect(entries[2]).toMatchObject({ kind: "outbound", id: "m-out", author: "info@theplayplus.com" });
    expect(entries[3]).toMatchObject({ kind: "inbound", id: "m-in", author: "luna@example.com" });
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
