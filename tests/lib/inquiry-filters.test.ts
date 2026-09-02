import { describe, it, expect } from "vitest";
import {
  DEFAULT_QUERY,
  inquiryDetailHref,
  inquiryListHref,
  parseInquiryListQuery,
  toInquiryListSearch,
} from "@/lib/inquiry-filters";

describe("parseInquiryListQuery", () => {
  it("returns defaults for empty params", () => {
    expect(parseInquiryListQuery({})).toEqual(DEFAULT_QUERY);
    expect(parseInquiryListQuery("")).toEqual(DEFAULT_QUERY);
    expect(parseInquiryListQuery(new URLSearchParams())).toEqual(DEFAULT_QUERY);
  });

  it("reads every field from a query string", () => {
    expect(parseInquiryListQuery("group=game_usage&type=bug_report&status=new&q=%EA%B2%B0%EC%A0%9C&sort=oldest&page=3")).toEqual({
      group: "game_usage",
      type: "bug_report",
      status: "new",
      q: "결제",
      sort: "oldest",
      page: 3,
    });
  });

  it("falls back on invalid status, sort, and page", () => {
    expect(parseInquiryListQuery("status=bogus&sort=sideways&page=-2")).toEqual(DEFAULT_QUERY);
    expect(parseInquiryListQuery("page=abc").page).toBe(1);
  });

  it("treats 'all' as no filter and takes the first of repeated params", () => {
    expect(parseInquiryListQuery({ group: "all", type: ["publishing", "x"] })).toMatchObject({
      group: null,
      type: "publishing",
    });
  });

  it("trims the search term", () => {
    expect(parseInquiryListQuery({ q: "  환불  " }).q).toBe("환불");
  });
});

describe("toInquiryListSearch", () => {
  it("is empty for the default query", () => {
    expect(toInquiryListSearch(DEFAULT_QUERY)).toBe("");
  });

  it("omits defaults and round-trips through the parser", () => {
    const query = { ...DEFAULT_QUERY, status: "resolved" as const, sort: "priority" as const, page: 2, q: "a b" };
    const search = toInquiryListSearch(query);
    expect(search).toBe("status=resolved&q=a+b&sort=priority&page=2");
    expect(parseInquiryListQuery(search)).toEqual(query);
  });
});

describe("hrefs", () => {
  it("builds the list href with and without a query", () => {
    expect(inquiryListHref("g1", DEFAULT_QUERY)).toBe("/games/g1/inquiries");
    expect(inquiryListHref("g1", { ...DEFAULT_QUERY, status: "new" })).toBe("/games/g1/inquiries?status=new");
  });

  it("carries the list state into the detail href", () => {
    expect(inquiryDetailHref("i1", DEFAULT_QUERY)).toBe("/inquiries/i1");
    expect(inquiryDetailHref("i1", { ...DEFAULT_QUERY, status: "new", page: 2 })).toBe(
      "/inquiries/i1?list=status%3Dnew%26page%3D2"
    );
  });
});
