// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { handleTabListKeyDown, tabPanelProps, tabProps } from "@/components/ui/tabs";

type Key = "a" | "b" | "c";
const KEYS: readonly Key[] = ["a", "b", "c"];

function Tabs({ onChange }: { onChange?: (key: Key) => void }) {
  const [tab, setTab] = useState<Key>("a");
  const change = (next: Key) => {
    setTab(next);
    onChange?.(next);
  };
  return (
    <>
      <div role="tablist" onKeyDown={(event) => handleTabListKeyDown(event, KEYS, tab, "t", change)}>
        {KEYS.map((key) => (
          <button key={key} {...tabProps("t", key, tab === key)} onClick={() => change(key)}>
            탭 {key}
          </button>
        ))}
      </div>
      <div {...tabPanelProps("t", tab)}>패널 {tab}</div>
    </>
  );
}

describe("tabs helpers", () => {
  it("wires ids so the tab and its panel reference each other", () => {
    render(<Tabs />);
    const tab = screen.getByRole("tab", { name: "탭 a" });
    const panel = screen.getByRole("tabpanel");
    expect(tab).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", tab.id);
    expect(tab).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "탭 b" })).toHaveAttribute("tabindex", "-1");
  });

  it("moves with arrows, wraps at the ends, and jumps with Home/End", async () => {
    const onChange = vi.fn();
    render(<Tabs onChange={onChange} />);
    screen.getByRole("tab", { name: "탭 a" }).focus();

    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "탭 c" })).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("패널 c");

    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "탭 a" })).toHaveFocus();

    await userEvent.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "탭 c" })).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "탭 a" })).toHaveFocus();
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it("ignores unrelated keys", async () => {
    const onChange = vi.fn();
    render(<Tabs onChange={onChange} />);
    screen.getByRole("tab", { name: "탭 a" }).focus();
    await userEvent.keyboard("x");
    expect(onChange).not.toHaveBeenCalled();
  });
});
