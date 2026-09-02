// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SyncRepliesButton from "@/components/inquiries/SyncRepliesButton";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

function mockFetchOnce(payload: unknown) {
  global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve(payload) }) as never;
}

describe("SyncRepliesButton", () => {
  beforeEach(() => refreshMock.mockReset());

  it("reports new replies and refreshes the page", async () => {
    mockFetchOnce({ success: true, added: 2 });
    render(<SyncRepliesButton inquiryId="inq-1" />);

    await userEvent.click(screen.getByRole("button", { name: "회신 확인" }));

    expect(global.fetch).toHaveBeenCalledWith("/api/inquiries/inq-1/sync-replies", expect.objectContaining({ method: "POST" }));
    expect(await screen.findByText("새 회신 2건을 가져왔습니다.")).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();
  });

  it("says so when nothing new arrived and does not refresh", async () => {
    mockFetchOnce({ success: true, added: 0 });
    render(<SyncRepliesButton inquiryId="inq-1" />);

    await userEvent.click(screen.getByRole("button", { name: "회신 확인" }));

    expect(await screen.findByText("새 회신이 없습니다.")).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("explains a Gmail permission problem", async () => {
    mockFetchOnce({ success: false, error: "fetch_failed" });
    render(<SyncRepliesButton inquiryId="inq-1" />);

    await userEvent.click(screen.getByRole("button", { name: "회신 확인" }));

    expect(await screen.findByText(/gmail\.readonly/)).toBeInTheDocument();
  });

  it("recovers from a thrown request", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("down")) as never;
    render(<SyncRepliesButton inquiryId="inq-1" />);

    await userEvent.click(screen.getByRole("button", { name: "회신 확인" }));

    expect(await screen.findByText("회신 확인에 실패했습니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "회신 확인" })).not.toBeDisabled();
  });
});
