// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ResolveButton from "@/components/inquiries/ResolveButton";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

describe("ResolveButton", () => {
  beforeEach(() => refresh.mockReset());

  it("marks an open inquiry resolved and refreshes", async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true }) }) as never;
    render(<ResolveButton inquiryId="inq-1" currentStatus="in_progress" />);

    await userEvent.click(screen.getByRole("button", { name: "완료로 표시" }));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/inquiries/inq-1/status",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "resolved" }) })
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("reopens a resolved inquiry as in_progress", async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true }) }) as never;
    render(<ResolveButton inquiryId="inq-1" currentStatus="resolved" />);

    await userEvent.click(screen.getByRole("button", { name: "다시 열기" }));

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body).toEqual({ status: "in_progress" });
  });

  it("shows an error and stays clickable when the request fails", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("down")) as never;
    render(<ResolveButton inquiryId="inq-1" currentStatus="new" />);

    await userEvent.click(screen.getByRole("button", { name: "완료로 표시" }));

    expect(await screen.findByText("상태 변경에 실패했습니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "완료로 표시" })).not.toBeDisabled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
