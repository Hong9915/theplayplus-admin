import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { listEvents, recordEvent, describeEvent } from "@/lib/events";

const sampleRow = {
  id: "evt-1",
  actor_email: "info@theplayplus.com",
  kind: "status_changed",
  from_value: "new",
  to_value: "resolved",
  created_at: "2026-09-02T04:00:00.000Z",
};

describe("describeEvent", () => {
  it("describes a status change with Korean labels", () => {
    expect(describeEvent({ kind: "status_changed", fromValue: "new", toValue: "resolved" })).toBe(
      "상태 접수 → 완료"
    );
  });

  it("describes a priority change with Korean labels", () => {
    expect(describeEvent({ kind: "priority_changed", fromValue: "normal", toValue: "urgent" })).toBe(
      "우선순위 보통 → 긴급"
    );
  });

  it("describes reply and note events without values", () => {
    expect(describeEvent({ kind: "reply_sent", fromValue: null, toValue: null })).toBe("답변 발송");
    expect(describeEvent({ kind: "note_added", fromValue: null, toValue: null })).toBe("메모 추가");
  });

  it("falls back to the raw value when a code has no Korean label", () => {
    expect(describeEvent({ kind: "status_changed", fromValue: null, toValue: "bogus" })).toBe(
      "상태 — → bogus"
    );
  });
});

describe("listEvents", () => {
  it("filters by inquiry_id and orders newest first", async () => {
    const order = vi.fn().mockResolvedValue({ data: [sampleRow], error: null });
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));

    const result = await listEvents({ from } as never, "inq-1");

    expect(from).toHaveBeenCalledWith("inquiry_events");
    expect(eq).toHaveBeenCalledWith("inquiry_id", "inq-1");
    expect(order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(result).toEqual([
      {
        id: "evt-1",
        actorEmail: "info@theplayplus.com",
        kind: "status_changed",
        fromValue: "new",
        toValue: "resolved",
        createdAt: "2026-09-02T04:00:00.000Z",
      },
    ]);
  });

  it("returns an empty array when the query errors", async () => {
    const order = vi.fn().mockResolvedValue({ data: null, error: { message: "db error" } });
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));

    await expect(listEvents({ from } as never, "inq-1")).resolves.toEqual([]);
  });
});

describe("recordEvent", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("inserts the event row", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn(() => ({ insert }));

    await recordEvent({ from } as never, {
      inquiryId: "inq-1",
      actor: { id: "user-1", email: "info@theplayplus.com" },
      kind: "status_changed",
      fromValue: "new",
      toValue: "resolved",
    });

    expect(from).toHaveBeenCalledWith("inquiry_events");
    expect(insert).toHaveBeenCalledWith({
      inquiry_id: "inq-1",
      actor_id: "user-1",
      actor_email: "info@theplayplus.com",
      kind: "status_changed",
      from_value: "new",
      to_value: "resolved",
    });
  });

  it("defaults from_value and to_value to null when omitted", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn(() => ({ insert }));

    await recordEvent({ from } as never, {
      inquiryId: "inq-1",
      actor: { id: "user-1", email: "a@b.com" },
      kind: "reply_sent",
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ from_value: null, to_value: null }));
  });

  it("swallows an insert error instead of throwing", async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: "db error" } });
    const from = vi.fn(() => ({ insert }));

    await expect(
      recordEvent({ from } as never, {
        inquiryId: "inq-1",
        actor: { id: "user-1", email: "a@b.com" },
        kind: "reply_sent",
      })
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("swallows a thrown error instead of propagating it", async () => {
    const from = vi.fn(() => {
      throw new Error("boom");
    });

    await expect(
      recordEvent({ from } as never, {
        inquiryId: "inq-1",
        actor: { id: "user-1", email: "a@b.com" },
        kind: "reply_sent",
      })
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});
