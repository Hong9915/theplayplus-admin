// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StatusMessage from "@/components/ui/StatusMessage";

describe("StatusMessage", () => {
  it("keeps an empty live region in the DOM so later messages are announced", () => {
    render(<StatusMessage className="text-sm">{null}</StatusMessage>);
    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveClass("sr-only");
  });

  it("shows the message with the tone colour when present", () => {
    render(
      <StatusMessage tone="success" className="text-sm">
        저장했습니다.
      </StatusMessage>
    );
    const region = screen.getByRole("status");
    expect(region).toHaveTextContent("저장했습니다.");
    expect(region).toHaveClass("text-emerald-700", "text-sm");
    expect(region).not.toHaveClass("sr-only");
  });

  it("treats an empty string as no message", () => {
    render(<StatusMessage>{""}</StatusMessage>);
    expect(screen.getByRole("status")).toHaveClass("sr-only");
  });
});
