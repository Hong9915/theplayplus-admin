import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as apply } from "@/app/api/assistant/messages/[id]/apply/route";
import { POST as cancel } from "@/app/api/assistant/messages/[id]/cancel/route";
import * as sessionModule from "@/lib/require-admin-session";
import * as storeModule from "@/lib/assistant-store";
import * as sheetsModule from "@/lib/sheets";
import * as categoriesModule from "@/lib/categories";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn(() => ({})) }));
vi.mock("@/lib/require-admin-session", () => ({ requireAdminSession: vi.fn(), getAdminSession: vi.fn() }));
vi.mock("@/lib/categories", () => ({ listGames: vi.fn() }));
vi.mock("@/lib/assistant-store", () => ({ getMessage: vi.fn(), getConversation: vi.fn(), updateProposalStatus: vi.fn() }));
vi.mock("@/lib/sheets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sheets")>();
  return { ...actual, applyProposal: vi.fn() };
});

const proposal = { kind: "update" as const, sheet: "VIP", row: 2, updates: [{ column: "VIP 단계", before: "VIP3", after: "VIP4" }] };
const message = { id: "m1", conversationId: "c1", role: "proposal" as const, content: "", proposal, status: "pending" as const, failureReason: null, appliedBy: null, appliedAt: null, createdAt: "" };
const conversation = { id: "c1", gameId: "g1", title: "t", createdBy: "a@b", createdAt: "", updatedAt: "" };
const game = { id: "g1", name: "G", status: "active", logoPath: null, ownerName: null, createdAt: "", sheetId: "sheet-1" };

const req = () => new Request("http://localhost/x", { method: "POST" });

describe("POST /api/assistant/messages/[id]/apply", () => {
  beforeEach(() => {
    vi.mocked(sessionModule.getAdminSession).mockReset().mockResolvedValue({ id: "u1", email: "a@b" });
    vi.mocked(storeModule.getMessage).mockReset().mockResolvedValue(message);
    vi.mocked(storeModule.getConversation).mockReset().mockResolvedValue(conversation);
    vi.mocked(storeModule.updateProposalStatus).mockReset().mockResolvedValue(true);
    vi.mocked(categoriesModule.listGames).mockReset().mockResolvedValue([game] as never);
    vi.mocked(sheetsModule.applyProposal).mockReset().mockResolvedValue(undefined);
  });

  it("returns 401 without a session", async () => {
    vi.mocked(sessionModule.getAdminSession).mockResolvedValue(null);
    expect((await apply(req(), { params: { id: "m1" } })).status).toBe(401);
  });

  it("returns 404 for a missing or non-proposal message", async () => {
    vi.mocked(storeModule.getMessage).mockResolvedValue(null);
    expect((await apply(req(), { params: { id: "m1" } })).status).toBe(404);
    vi.mocked(storeModule.getMessage).mockResolvedValue({ ...message, role: "assistant", proposal: null });
    expect((await apply(req(), { params: { id: "m1" } })).status).toBe(404);
  });

  it("returns 409 when the proposal is not pending", async () => {
    vi.mocked(storeModule.getMessage).mockResolvedValue({ ...message, status: "applied" });
    const response = await apply(req(), { params: { id: "m1" } });
    expect(response.status).toBe(409);
    expect(sheetsModule.applyProposal).not.toHaveBeenCalled();
  });

  it("applies the proposal and records who did it", async () => {
    const response = await apply(req(), { params: { id: "m1" } });
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json).toMatchObject({ success: true, status: "applied", appliedBy: "a@b" });
    expect(typeof json.appliedAt).toBe("string");
    expect(sheetsModule.applyProposal).toHaveBeenCalledWith("sheet-1", proposal);
    expect(storeModule.updateProposalStatus).toHaveBeenCalledWith(expect.anything(), "m1", { status: "applied", appliedBy: "a@b", appliedAt: json.appliedAt });
  });

  it("marks the proposal failed with the sheet error reason", async () => {
    vi.mocked(sheetsModule.applyProposal).mockRejectedValue(new sheetsModule.SheetError("conflict"));
    const response = await apply(req(), { params: { id: "m1" } });
    expect(await response.json()).toEqual({ success: false, status: "failed", failureReason: "conflict" });
    expect(storeModule.updateProposalStatus).toHaveBeenCalledWith(expect.anything(), "m1", { status: "failed", failureReason: "conflict" });
  });

  it("fails with not_configured when the game lost its sheet", async () => {
    vi.mocked(categoriesModule.listGames).mockResolvedValue([{ ...game, sheetId: null }] as never);
    const response = await apply(req(), { params: { id: "m1" } });
    expect(await response.json()).toEqual({ success: false, status: "failed", failureReason: "not_configured" });
  });
});

describe("POST /api/assistant/messages/[id]/cancel", () => {
  beforeEach(() => {
    vi.mocked(sessionModule.requireAdminSession).mockReset().mockResolvedValue(true);
    vi.mocked(storeModule.getMessage).mockReset().mockResolvedValue(message);
    vi.mocked(storeModule.updateProposalStatus).mockReset().mockResolvedValue(true);
  });

  it("cancels a pending proposal", async () => {
    const response = await cancel(req(), { params: { id: "m1" } });
    expect(await response.json()).toEqual({ success: true, status: "cancelled" });
    expect(storeModule.updateProposalStatus).toHaveBeenCalledWith(expect.anything(), "m1", { status: "cancelled" });
  });

  it("returns 409 when not pending", async () => {
    vi.mocked(storeModule.getMessage).mockResolvedValue({ ...message, status: "cancelled" });
    expect((await cancel(req(), { params: { id: "m1" } })).status).toBe(409);
  });
});
