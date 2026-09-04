import { describe, it, expect } from "vitest";
import {
  DEFAULT_QUERY,
  inquiryHref,
  inboxHref,
  inquiryListHref,
  legacyInquiryRedirectHref,
  parseInquiryListQuery,
  toInquiryListSearch,
} from "@/lib/inquiry-filters";
import { SERVICE_SCOPE, gameScope } from "@/lib/inbox-scope";

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
      priority: null,
      stale: false,
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
    expect(inquiryListHref(gameScope("g1"), DEFAULT_QUERY)).toBe("/games/g1/inquiries");
    expect(inquiryListHref(gameScope("g1"), { ...DEFAULT_QUERY, status: "new" })).toBe("/games/g1/inquiries?status=new");
  });

  it("builds service inbox hrefs under /service", () => {
    expect(inquiryListHref(SERVICE_SCOPE, DEFAULT_QUERY)).toBe("/service/inquiries");
    expect(inquiryListHref(SERVICE_SCOPE, { ...DEFAULT_QUERY, status: "new" })).toBe("/service/inquiries?status=new");
    expect(inquiryHref(SERVICE_SCOPE, "i1", { ...DEFAULT_QUERY, page: 2 })).toBe("/service/inquiries/i1?page=2");
    expect(inboxHref(SERVICE_SCOPE, null, DEFAULT_QUERY)).toBe("/service/inquiries");
    expect(inboxHref(SERVICE_SCOPE, "i1", DEFAULT_QUERY)).toBe("/service/inquiries/i1");
    expect(legacyInquiryRedirectHref(SERVICE_SCOPE, "i1", "status=new")).toBe("/service/inquiries/i1?status=new");
  });
});

describe("priority and stale", () => {
  it("parses a valid priority and drops an invalid one", () => {
    expect(parseInquiryListQuery("priority=urgent").priority).toBe("urgent");
    expect(parseInquiryListQuery("priority=whatever").priority).toBeNull();
  });

  it("parses stale=1 only", () => {
    expect(parseInquiryListQuery("stale=1").stale).toBe(true);
    expect(parseInquiryListQuery("stale=true").stale).toBe(false);
    expect(parseInquiryListQuery("").stale).toBe(false);
  });

  it("serializes priority and stale and round-trips", () => {
    const query = { ...DEFAULT_QUERY, priority: "high" as const, stale: true };
    expect(toInquiryListSearch(query)).toBe("priority=high&stale=1");
    expect(parseInquiryListQuery(toInquiryListSearch(query))).toEqual(query);
  });

  it("keeps the existing serialization order for the old fields", () => {
    const query = { ...DEFAULT_QUERY, status: "resolved" as const, sort: "priority" as const, page: 2, q: "a b" };
    expect(toInquiryListSearch(query)).toBe("status=resolved&q=a+b&sort=priority&page=2");
  });
});

describe("inbox hrefs", () => {
  it("builds the inquiry href with the list query on the same URL", () => {
    expect(inquiryHref(gameScope("g1"), "i1", DEFAULT_QUERY)).toBe("/games/g1/inquiries/i1");
    expect(inquiryHref(gameScope("g1"), "i1", { ...DEFAULT_QUERY, status: "new", page: 2 })).toBe(
      "/games/g1/inquiries/i1?status=new&page=2"
    );
  });

  it("inboxHref keeps the selected inquiry when there is one", () => {
    expect(inboxHref(gameScope("g1"), null, { ...DEFAULT_QUERY, q: "x" })).toBe("/games/g1/inquiries?q=x");
    expect(inboxHref(gameScope("g1"), "i1", { ...DEFAULT_QUERY, q: "x" })).toBe("/games/g1/inquiries/i1?q=x");
  });

  it("legacy redirect decodes the old list param into the new URL", () => {
    expect(legacyInquiryRedirectHref(gameScope("g1"), "i1", undefined)).toBe("/games/g1/inquiries/i1");
    expect(legacyInquiryRedirectHref(gameScope("g1"), "i1", "status=new&sort=oldest")).toBe(
      "/games/g1/inquiries/i1?status=new&sort=oldest"
    );
    expect(legacyInquiryRedirectHref(gameScope("g1"), "i1", "status=bogus")).toBe("/games/g1/inquiries/i1");
  });
});
