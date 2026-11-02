// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import TitleCount, { TITLE_COUNT_EVENT } from "@/components/layout/TitleCount";

describe("TitleCount", () => {
  beforeEach(() => {
    document.title = "THE PLAY+ Admin";
  });

  it("prefixes the tab title with the count and updates it on rerender", () => {
    const { rerender } = render(<TitleCount count={12} />);
    expect(document.title).toBe("(12) THE PLAY+ Admin");
    rerender(<TitleCount count={0} />);
    expect(document.title).toBe("THE PLAY+ Admin");
  });

  it("takes a new count from the window event", () => {
    render(<TitleCount count={1} />);
    act(() => {
      window.dispatchEvent(new CustomEvent(TITLE_COUNT_EVENT, { detail: 9 }));
    });
    expect(document.title).toBe("(9) THE PLAY+ Admin");
  });

  it("re-applies the count when the title is replaced by navigation", async () => {
    render(<TitleCount count={3} />);
    document.title = "다른 화면";
    await waitFor(() => expect(document.title).toBe("(3) 다른 화면"));
  });

  it("removes the count on unmount", () => {
    const { unmount } = render(<TitleCount count={3} />);
    unmount();
    expect(document.title).toBe("THE PLAY+ Admin");
  });
});
