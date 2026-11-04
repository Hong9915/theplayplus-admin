// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CategoryManager from "@/components/categories/CategoryManager";
import type { CategoryGroupSetting } from "@/lib/category-settings";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));

const FLAGS = {
  requiresGameAccount: true,
  requiresCompanyName: false,
  allowAttachments: true,
  requiresAttachments: false,
  collectsPaymentNo: false,
  collectsOccurredAt: true,
  collectsDeviceInfo: false,
  collectsStore: true,
  collectsCharacter: true,
};

const groups: CategoryGroupSetting[] = [
  {
    id: "g1",
    key: "game_usage",
    labelKo: "게임 이용",
    labelZh: "游戏使用",
    labelEn: "Game Usage",
    sortOrder: 0,
    types: [
      { id: "t1", groupId: "g1", key: "suggestion", labelKo: "건의 사항", labelZh: null, labelEn: null, ...FLAGS, defaultPriority: "low", sortOrder: 0 },
      { id: "t2", groupId: "g1", key: "bug_report", labelKo: "버그 제보(기타)", labelZh: null, labelEn: null, ...FLAGS, defaultPriority: "normal", sortOrder: 1 },
    ],
  },
];

function mockFetch(json: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ json: () => Promise.resolve(json) });
  global.fetch = fetchMock as never;
  return fetchMock;
}

describe("CategoryManager", () => {
  beforeEach(() => refresh.mockReset());

  it("shows keys read-only and what each type asks", () => {
    render(<CategoryManager gameId="game-1" groups={groups} />);
    expect(screen.getByText("suggestion")).toBeInTheDocument();
    expect(screen.getAllByText(/서버·캐릭터 ID·캐릭터명 받기\(필수\)/)).toHaveLength(2);
  });

  it("disables 첨부 필수 once 첨부 허용 is off, and does not send a key on edit", async () => {
    const fetchMock = mockFetch({ success: true });
    render(<CategoryManager gameId="game-1" groups={groups} />);
    await userEvent.click(screen.getByRole("button", { name: "건의 사항 수정" }));
    const form = screen.getByRole("form", { name: "건의 사항 수정" });
    await userEvent.click(within(form).getByLabelText(/^첨부 필수/));
    expect(within(form).getByLabelText(/^첨부 필수/)).toBeChecked();
    await userEvent.click(within(form).getByLabelText(/^첨부 허용/));
    expect(within(form).getByLabelText(/^첨부 필수/)).toBeDisabled();
    expect(within(form).getByLabelText(/^첨부 필수/)).not.toBeChecked();

    await userEvent.click(within(form).getByRole("button", { name: "저장" }));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/games/game-1/categories/types/t1");
    const body = JSON.parse(init.body);
    expect(body).not.toHaveProperty("key");
    expect(body).toMatchObject({ groupId: "g1", allowAttachments: false, requiresAttachments: false, collectsCharacter: true, defaultPriority: "low" });
    expect(refresh).toHaveBeenCalled();
  });

  it("asks in place before deleting and shows why it was refused", async () => {
    const fetchMock = mockFetch({ success: false, error: "in_use", message: "삭제할 수 없습니다 — 남아 있는 것: 이 유형으로 접수된 문의 4건." });
    const confirmSpy = vi.spyOn(window, "confirm");
    render(<CategoryManager gameId="game-1" groups={groups} />);
    await userEvent.click(screen.getByRole("button", { name: "건의 사항 삭제" }));
    expect(fetchMock).not.toHaveBeenCalled();
    const confirm = screen.getByRole("group", { name: "건의 사항 삭제 확인" });
    await userEvent.click(within(confirm).getByRole("button", { name: "예" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/games/game-1/categories/types/t1", expect.objectContaining({ method: "DELETE" }));
    expect(await screen.findByText(/문의 4건/)).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("checks the key before adding a type", async () => {
    const fetchMock = mockFetch({ success: true });
    render(<CategoryManager gameId="game-1" groups={groups} />);
    await userEvent.click(screen.getByRole("button", { name: "+ 게임 이용에 유형 추가" }));
    const form = screen.getByRole("form", { name: "새 유형" });
    await userEvent.type(within(form).getByLabelText(/^키/), "Coupon");
    await userEvent.type(within(form).getByLabelText("한국어 이름"), "쿠폰");
    await userEvent.click(within(form).getByRole("button", { name: "유형 추가" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/영어 소문자로 시작/)).toBeInTheDocument();

    await userEvent.clear(within(form).getByLabelText(/^키/));
    await userEvent.type(within(form).getByLabelText(/^키/), "coupon");
    await userEvent.click(within(form).getByRole("button", { name: "유형 추가" }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ key: "coupon", groupId: "g1", labelKo: "쿠폰", requiresGameAccount: true, collectsStore: true, defaultPriority: "normal" });
  });

  it("moves a type down by saving the whole order", async () => {
    const fetchMock = mockFetch({ success: true });
    render(<CategoryManager gameId="game-1" groups={groups} />);
    expect(screen.getByRole("button", { name: "건의 사항 위로" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "건의 사항 아래로" }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ groups: [{ id: "g1", typeIds: ["t2", "t1"] }] });
  });
});
