// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Dialog from "@/components/ui/Dialog";

function Harness({ onClose, dismissDisabled = false }: { onClose: () => void; dismissDisabled?: boolean }) {
  return (
    <>
      <button type="button">바깥 버튼</button>
      <Dialog label="테스트" onClose={onClose} dismissDisabled={dismissDisabled}>
        <button type="button">첫째</button>
        <input aria-label="가운데" />
        <button type="button">마지막</button>
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  it("moves focus to the first control on open", () => {
    render(<Harness onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "첫째" })).toHaveFocus();
  });

  it("prefers a data-autofocus control", () => {
    render(
      <Dialog label="테스트" onClose={vi.fn()}>
        <button type="button">첫째</button>
        <button type="button" data-autofocus>
          여기
        </button>
      </Dialog>
    );
    expect(screen.getByRole("button", { name: "여기" })).toHaveFocus();
  });

  it("keeps Tab and Shift+Tab inside the dialog", async () => {
    render(<Harness onClose={vi.fn()} />);
    screen.getByRole("button", { name: "마지막" }).focus();
    await userEvent.keyboard("{Tab}");
    expect(screen.getByRole("button", { name: "첫째" })).toHaveFocus();
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    expect(screen.getByRole("button", { name: "마지막" })).toHaveFocus();
  });

  it("closes on Escape and on a backdrop click, but not on a click inside", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "첫째" }));
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("ignores Escape and backdrop clicks while dismissal is disabled", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} dismissDisabled />);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("returns focus to the element that was focused before it opened", () => {
    const { rerender } = render(<button type="button">여는 버튼</button>);
    const opener = screen.getByRole("button", { name: "여는 버튼" });
    opener.focus();
    rerender(
      <>
        <button type="button">여는 버튼</button>
        <Dialog label="테스트" onClose={vi.fn()}>
          <button type="button">안</button>
        </Dialog>
      </>
    );
    expect(screen.getByRole("button", { name: "안" })).toHaveFocus();
    rerender(<button type="button">여는 버튼</button>);
    expect(opener).toHaveFocus();
  });

  it("is labelled and modal", () => {
    render(<Harness onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "테스트" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("lets only the topmost of nested dialogs react to Escape", async () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <Dialog label="바깥" onClose={outer}>
        <button type="button">바깥 버튼</button>
        <Dialog label="안쪽" onClose={inner}>
          <button type="button">안쪽 버튼</button>
        </Dialog>
      </Dialog>
    );
    await userEvent.keyboard("{Escape}");
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it("keeps Tab inside the inner dialog while one is open", async () => {
    render(
      <Dialog label="바깥" onClose={vi.fn()}>
        <button type="button">바깥 버튼</button>
        <Dialog label="안쪽" onClose={vi.fn()}>
          <button type="button">안쪽 하나</button>
          <button type="button">안쪽 둘</button>
        </Dialog>
      </Dialog>
    );
    screen.getByRole("button", { name: "안쪽 둘" }).focus();
    await userEvent.keyboard("{Tab}");
    expect(screen.getByRole("button", { name: "안쪽 하나" })).toHaveFocus();
  });

  it("slides in from the right as a drawer when placed right", () => {
    render(
      <Dialog label="서랍" onClose={vi.fn()} placement="right">
        <button type="button">안</button>
      </Dialog>
    );
    const panel = screen.getByRole("dialog", { name: "서랍" });
    expect(panel.className).toMatch(/h-full/);
    expect(panel.parentElement?.className).toMatch(/justify-end/);
  });
});
