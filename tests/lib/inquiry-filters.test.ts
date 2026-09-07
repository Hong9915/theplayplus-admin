import { describe, it, expect } from "vitest";
import { DEFAULT_QUERY, inquiryHref, parseInquiryListQuery, toInquiryListSearch } from "@/lib/inquiry-filters";
import { gameScope } from "@/lib/inbox-scope";

describe("unread filter", () => {
  it("parses unread=1 and ignores other values", () => {
    expect(parseInquiryListQuery("unread=1").unread).toBe(true);
    expect(parseInquiryListQuery("unread=0").unread).toBe(false);
    expect(parseInquiryListQuery("").unread).toBe(false);
  });

  it("round-trips through the search string", () => {
    const search = toInquiryListSearch({ ...DEFAULT_QUERY, unread: true });
    expect(search).toBe("unread=1");
    expect(parseInquiryListQuery(search).unread).toBe(true);
  });

  it("stays in the URL when opening an inquiry", () => {
    expect(inquiryHref(gameScope("g1"), "inq-1", { ...DEFAULT_QUERY, unread: true })).toBe(
      "/games/g1/inquiries/inq-1?unread=1"
    );
  });
});
