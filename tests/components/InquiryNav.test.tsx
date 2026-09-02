// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import InquiryNav from "@/components/inquiries/InquiryNav";
import { DEFAULT_QUERY } from "@/lib/inquiry-filters";

describe("InquiryNav", () => {
  it("links back to the list with the carried filters", () => {
    render(<InquiryNav gameId="g1" inquiryId="b" query={{ ...DEFAULT_QUERY, status: "new" }} ids={["a", "b", "c"]} />);
    expect(screen.getByRole("link", { name: "← 목록" })).toHaveAttribute("href", "/games/g1/inquiries?status=new");
  });

  it("shows position and links to the previous and next inquiries with the same list state", () => {
    render(<InquiryNav gameId="g1" inquiryId="b" query={{ ...DEFAULT_QUERY, sort: "oldest" }} ids={["a", "b", "c"]} />);
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← 이전" })).toHaveAttribute("href", "/inquiries/a?list=sort%3Doldest");
    expect(screen.getByRole("link", { name: "다음 →" })).toHaveAttribute("href", "/inquiries/c?list=sort%3Doldest");
  });

  it("disables the edge controls at the ends of the list", () => {
    const { rerender } = render(<InquiryNav gameId="g1" inquiryId="a" query={DEFAULT_QUERY} ids={["a", "b"]} />);
    expect(screen.queryByRole("link", { name: "← 이전" })).not.toBeInTheDocument();
    expect(screen.getByText("← 이전")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("link", { name: "다음 →" })).toHaveAttribute("href", "/inquiries/b");

    rerender(<InquiryNav gameId="g1" inquiryId="b" query={DEFAULT_QUERY} ids={["a", "b"]} />);
    expect(screen.queryByRole("link", { name: "다음 →" })).not.toBeInTheDocument();
  });

  it("hides prev/next when the inquiry is not in the list or the list has one item", () => {
    const { rerender } = render(<InquiryNav gameId="g1" inquiryId="zzz" query={DEFAULT_QUERY} ids={["a", "b"]} />);
    expect(screen.queryByText("← 이전")).not.toBeInTheDocument();

    rerender(<InquiryNav gameId="g1" inquiryId="a" query={DEFAULT_QUERY} ids={["a"]} />);
    expect(screen.queryByText("← 이전")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← 목록" })).toBeInTheDocument();
  });
});
