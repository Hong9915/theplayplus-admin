// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InboxSearch from "@/components/inbox/InboxSearch";
import { DEFAULT_QUERY } from "@/lib/inquiry-filters";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

describe("InboxSearch", () => {
  beforeEach(() => replace.mockReset());

  it("shows the current term", () => {
    render(<InboxSearch gameId="g1" query={{ ...DEFAULT_QUERY, q: "환불" }} selectedId={null} />);
    expect(screen.getByLabelText("검색")).toHaveValue("환불");
  });

  it("debounces typing into the URL and resets the page", async () => {
    render(<InboxSearch gameId="g1" query={{ ...DEFAULT_QUERY, page: 3 }} selectedId={null} />);
    await userEvent.type(screen.getByLabelText("검색"), "결제");
    expect(replace).not.toHaveBeenCalled();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/games/g1/inquiries?q=%EA%B2%B0%EC%A0%9C"));
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("keeps the selected inquiry in the URL", async () => {
    render(<InboxSearch gameId="g1" query={DEFAULT_QUERY} selectedId="i1" />);
    await userEvent.type(screen.getByLabelText("검색"), "a");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/games/g1/inquiries/i1?q=a"));
  });
});
