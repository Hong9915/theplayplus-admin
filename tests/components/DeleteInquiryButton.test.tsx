// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DeleteInquiryButton from "@/components/inquiries/DeleteInquiryButton";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

const LIST_HREF = "/games/game-1/inquiries?status=new";

describe("DeleteInquiryButton", () => {
  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true }) }) as never;
  });

  it("opens a confirm dialog naming the inquiry number", async () => {
    render(<DeleteInquiryButton inquiryId="inq-1" inquiryNo="R-20260903-0007" afterDeleteHref={LIST_HREF} />);

    await userEvent.click(screen.getByRole("button", { name: "문의 삭제…" }));

    expect(screen.getByRole("dialog", { name: "문의 삭제" })).toBeInTheDocument();
    expect(screen.getByText("R-20260903-0007")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "취소" })).toHaveFocus();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("cancel closes the dialog without deleting", async () => {
    render(<DeleteInquiryButton inquiryId="inq-1" inquiryNo={null} afterDeleteHref={LIST_HREF} />);

    await userEvent.click(screen.getByRole("button", { name: "문의 삭제…" }));
    await userEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("confirming calls the delete API and returns to the list", async () => {
    render(<DeleteInquiryButton inquiryId="inq-1" inquiryNo="R-20260903-0007" afterDeleteHref={LIST_HREF} />);

    await userEvent.click(screen.getByRole("button", { name: "문의 삭제…" }));
    await userEvent.click(screen.getByRole("button", { name: "삭제" }));

    expect(global.fetch).toHaveBeenCalledWith("/api/inquiries/inq-1", { method: "DELETE" });
    expect(push).toHaveBeenCalledWith(LIST_HREF);
    expect(refresh).toHaveBeenCalled();
  });

  it("shows an error and stays open when the API fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: false }) }) as never;
    render(<DeleteInquiryButton inquiryId="inq-1" inquiryNo="R-20260903-0007" afterDeleteHref={LIST_HREF} />);

    await userEvent.click(screen.getByRole("button", { name: "문의 삭제…" }));
    await userEvent.click(screen.getByRole("button", { name: "삭제" }));

    expect(await screen.findByRole("status")).toHaveTextContent("삭제에 실패했습니다. 다시 시도해주세요.");
    expect(screen.getByRole("dialog", { name: "문의 삭제" })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
