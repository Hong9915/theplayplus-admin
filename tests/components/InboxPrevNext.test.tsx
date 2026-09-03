// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import InboxPrevNext from "@/components/inbox/InboxPrevNext";
import { DEFAULT_QUERY } from "@/lib/inquiry-filters";

describe("InboxPrevNext", () => {
  it("links to the previous and next inquiries on the same query", () => {
    render(<InboxPrevNext gameId="g1" inquiryId="b" query={{ ...DEFAULT_QUERY, sort: "oldest" }} ids={["a", "b", "c"]} />);
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "이전 문의" })).toHaveAttribute("href", "/games/g1/inquiries/a?sort=oldest");
    expect(screen.getByRole("link", { name: "다음 문의" })).toHaveAttribute("href", "/games/g1/inquiries/c?sort=oldest");
  });

  it("disables the edges", () => {
    render(<InboxPrevNext gameId="g1" inquiryId="a" query={DEFAULT_QUERY} ids={["a", "b"]} />);
    expect(screen.queryByRole("link", { name: "이전 문의" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "다음 문의" })).toHaveAttribute("href", "/games/g1/inquiries/b");
  });

  it("renders nothing when the inquiry is not in the list or the list is a single item", () => {
    const { container, rerender } = render(<InboxPrevNext gameId="g1" inquiryId="zzz" query={DEFAULT_QUERY} ids={["a", "b"]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<InboxPrevNext gameId="g1" inquiryId="a" query={DEFAULT_QUERY} ids={["a"]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
