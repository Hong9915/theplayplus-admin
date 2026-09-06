// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SheetSettingsDialog from "@/components/assistant/SheetSettingsDialog";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));

describe("SheetSettingsDialog", () => {
  beforeEach(() => {
    refresh.mockReset();
    global.fetch = vi.fn() as never;
  });

  it("shows the service account to share with", () => {
    render(<SheetSettingsDialog gameId="g1" currentSheetId={null} serviceAccountEmail="bot@proj.iam.gserviceaccount.com" onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "시트 설정" })).toBeInTheDocument();
    expect(screen.getByText("bot@proj.iam.gserviceaccount.com")).toBeInTheDocument();
  });

  it("tells the admin to set the env var when there is no service account", () => {
    render(<SheetSettingsDialog gameId="g1" currentSheetId={null} serviceAccountEmail={null} onClose={vi.fn()} />);
    expect(screen.getByText(/GOOGLE_SERVICE_ACCOUNT_JSON/)).toBeInTheDocument();
  });

  it("saves the url via PATCH and refreshes", async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true, sheetId: "1AbC", serviceAccountEmail: "bot@x" }) } as never);
    const onClose = vi.fn();
    render(<SheetSettingsDialog gameId="g1" currentSheetId={null} serviceAccountEmail="bot@x" onClose={onClose} />);

    await userEvent.type(screen.getByRole("textbox", { name: "시트 URL" }), "https://docs.google.com/spreadsheets/d/1AbC/edit");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(global.fetch).toHaveBeenCalledWith("/api/games/g1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sheetUrl: "https://docs.google.com/spreadsheets/d/1AbC/edit" }),
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an inline error for an invalid url", async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: false, json: () => Promise.resolve({ success: false, error: "invalid_input" }) } as never);
    render(<SheetSettingsDialog gameId="g1" currentSheetId={null} serviceAccountEmail="bot@x" onClose={vi.fn()} />);

    await userEvent.type(screen.getByRole("textbox", { name: "시트 URL" }), "nope");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(screen.getByText(/URL을 확인/)).toBeInTheDocument());
  });
});
