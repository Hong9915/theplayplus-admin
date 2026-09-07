// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SourceAddDialog from "@/components/assistant/SourceAddDialog";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));

async function submit(url: string) {
  await userEvent.type(screen.getByLabelText("자료 URL"), url);
  await userEvent.click(screen.getByRole("button", { name: "추가" }));
}

describe("SourceAddDialog", () => {
  beforeEach(() => {
    refresh.mockReset();
    global.fetch = vi.fn() as never;
  });

  it("shows the service account to share with", () => {
    render(<SourceAddDialog gameId="g1" serviceAccountEmail="bot@proj.iam.gserviceaccount.com" onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "자료 추가" })).toBeInTheDocument();
    expect(screen.getByText("bot@proj.iam.gserviceaccount.com")).toBeInTheDocument();
  });

  it("tells the admin to set the env var when there is no service account", () => {
    render(<SourceAddDialog gameId="g1" serviceAccountEmail={null} onClose={vi.fn()} />);
    expect(screen.getByText(/GOOGLE_SERVICE_ACCOUNT_JSON/)).toBeInTheDocument();
  });

  it("posts the url, refreshes, and closes", async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true, source: { id: "s1" } }) } as never);
    const onClose = vi.fn();
    render(<SourceAddDialog gameId="g1" serviceAccountEmail="bot@x" onClose={onClose} />);
    await submit("https://docs.google.com/document/d/1DoC/edit");
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/games/g1/sources", expect.objectContaining({ method: "POST", body: JSON.stringify({ url: "https://docs.google.com/document/d/1DoC/edit" }) })));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it.each([
    ["invalid_input", "구글 시트 또는 문서의 URL 전체를 붙여넣으세요."],
    ["source_forbidden", "읽을 권한이 없습니다. 위 서비스 계정에 먼저 공유한 뒤 다시 시도하세요."],
    ["source_not_found", "자료를 찾을 수 없습니다. URL을 확인하세요."],
    ["duplicate", "이미 연결된 자료입니다."],
    ["not_configured", "서비스 계정이 설정되지 않았습니다."],
    ["save_failed", "저장하지 못했습니다."],
  ])("explains %s inline", async (error, text) => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: false, json: () => Promise.resolve({ success: false, error }) } as never);
    const onClose = vi.fn();
    render(<SourceAddDialog gameId="g1" serviceAccountEmail="bot@x" onClose={onClose} />);
    await submit("https://docs.google.com/document/d/1DoC/edit");
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
