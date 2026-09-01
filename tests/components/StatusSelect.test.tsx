// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StatusSelect from "@/components/inquiries/StatusSelect";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

describe("StatusSelect", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true }) }) as never;
  });

  it("sends a PATCH request and refreshes on change", async () => {
    render(<StatusSelect inquiryId="inq-1" currentStatus="new" />);
    await userEvent.selectOptions(screen.getByLabelText("상태"), "완료");

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/inquiries/inq-1/status",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "resolved" }),
      })
    );
    expect(refreshMock).toHaveBeenCalled();
  });

  it("reverts to the previous value and shows an error when the request throws", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network error")) as never;
    render(<StatusSelect inquiryId="inq-1" currentStatus="new" />);

    await userEvent.selectOptions(screen.getByLabelText("상태"), "완료");

    expect(await screen.findByText("상태 변경에 실패했습니다.")).toBeInTheDocument();
    expect(screen.getByLabelText("상태")).toHaveValue("new");
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
