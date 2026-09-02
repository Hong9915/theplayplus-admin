// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PrioritySelect from "@/components/inquiries/PrioritySelect";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

describe("PrioritySelect", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true }) }) as never;
  });

  it("sends a PATCH request and refreshes on change", async () => {
    render(<PrioritySelect inquiryId="inq-1" currentPriority="normal" />);
    await userEvent.selectOptions(screen.getByLabelText("우선순위"), "긴급");

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/inquiries/inq-1/priority",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ priority: "urgent" }),
      })
    );
    expect(refreshMock).toHaveBeenCalled();
  });

  it("reverts and shows an error when the request throws", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network error")) as never;
    render(<PrioritySelect inquiryId="inq-1" currentPriority="normal" />);

    await userEvent.selectOptions(screen.getByLabelText("우선순위"), "긴급");

    expect(await screen.findByText("우선순위 변경에 실패했습니다.")).toBeInTheDocument();
    expect(screen.getByLabelText("우선순위")).toHaveValue("normal");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("reverts when the API returns success: false", async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: false }) }) as never;
    render(<PrioritySelect inquiryId="inq-1" currentPriority="low" />);

    await userEvent.selectOptions(screen.getByLabelText("우선순위"), "높음");

    expect(await screen.findByText("우선순위 변경에 실패했습니다.")).toBeInTheDocument();
    expect(screen.getByLabelText("우선순위")).toHaveValue("low");
  });
});
