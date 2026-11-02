// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import RealtimeRefresh from "@/components/layout/RealtimeRefresh";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

type Handler = () => void;
const handlers: Handler[] = [];
const channelMock = {
  on: vi.fn((_type: string, _filter: unknown, handler: Handler) => {
    handlers.push(handler);
    return channelMock;
  }),
  subscribe: vi.fn(() => channelMock),
};
const supabaseMock = {
  channel: vi.fn(() => channelMock),
  removeChannel: vi.fn(),
};
vi.mock("@/lib/supabase-browser", () => ({ getSupabaseBrowserClient: () => supabaseMock }));

function fireChange() {
  for (const handler of handlers) handler();
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

describe("RealtimeRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refreshMock.mockReset();
    handlers.length = 0;
    channelMock.on.mockClear();
    channelMock.subscribe.mockClear();
    supabaseMock.channel.mockClear();
    supabaseMock.removeChannel.mockClear();
    setVisibility("visible");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("subscribes to the private admin:changes channel and listens for change events", () => {
    render(<RealtimeRefresh />);
    expect(supabaseMock.channel).toHaveBeenCalledWith("admin:changes", { config: { private: true } });
    expect(channelMock.on).toHaveBeenCalledWith("broadcast", { event: "change" }, expect.any(Function));
    expect(channelMock.subscribe).toHaveBeenCalled();
  });

  it("refreshes once after a burst of change events", () => {
    render(<RealtimeRefresh />);
    fireChange();
    fireChange();
    vi.advanceTimersByTime(500);
    fireChange();
    expect(refreshMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("defers the refresh while the tab is hidden and runs it when it becomes visible", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<RealtimeRefresh />);
    setVisibility("hidden");
    fireChange();
    vi.advanceTimersByTime(2000);
    expect(refreshMock).not.toHaveBeenCalled();

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refreshMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("fetches only the notification count while hidden and announces it for the tab title", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, count: 7 })));
    vi.stubGlobal("fetch", fetchMock);
    const listener = vi.fn();
    window.addEventListener("admin:notification-count", listener);
    try {
      render(<RealtimeRefresh />);
      setVisibility("hidden");
      fireChange();
      await vi.advanceTimersByTimeAsync(1000);
      expect(fetchMock).toHaveBeenCalledWith("/api/notifications/count", { cache: "no-store" });
      expect(listener).toHaveBeenCalledTimes(1);
      expect((listener.mock.calls[0][0] as CustomEvent<number>).detail).toBe(7);
      expect(refreshMock).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("admin:notification-count", listener);
      vi.unstubAllGlobals();
    }
  });

  it("does nothing on visibilitychange when no change arrived while hidden", () => {
    render(<RealtimeRefresh />);
    setVisibility("hidden");
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("removes the channel and drops a pending refresh on unmount", () => {
    const { unmount } = render(<RealtimeRefresh />);
    fireChange();
    unmount();
    vi.advanceTimersByTime(2000);
    expect(supabaseMock.removeChannel).toHaveBeenCalledWith(channelMock);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
