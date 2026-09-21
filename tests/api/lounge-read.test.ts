import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as readOne } from "@/app/api/lounge/items/[id]/read/route";
import { POST as readAll } from "@/app/api/games/[gameId]/lounge/read-all/route";
import * as sessionModule from "@/lib/require-admin-session";
import * as itemsModule from "@/lib/lounge-items";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn(() => ({})) }));
vi.mock("@/lib/require-admin-session", () => ({ requireAdminSession: vi.fn() }));
vi.mock("@/lib/lounge-items", () => ({ markLoungeItemRead: vi.fn(), markAllLoungeItemsRead: vi.fn() }));

const req = () => new Request("https://admin.example/x", { method: "POST" });

describe("lounge read routes", () => {
  beforeEach(() => {
    vi.mocked(sessionModule.requireAdminSession).mockResolvedValue(true);
    vi.mocked(itemsModule.markLoungeItemRead).mockReset().mockResolvedValue(true);
    vi.mocked(itemsModule.markAllLoungeItemsRead).mockReset().mockResolvedValue(true);
  });

  it("requires an admin session", async () => {
    vi.mocked(sessionModule.requireAdminSession).mockResolvedValue(false);
    expect((await readOne(req(), { params: { id: "i1" } })).status).toBe(401);
    expect((await readAll(req(), { params: { gameId: "g1" } })).status).toBe(401);
    expect(itemsModule.markLoungeItemRead).not.toHaveBeenCalled();
  });

  it("marks one item and all items of a game as read", async () => {
    expect((await readOne(req(), { params: { id: "i1" } })).status).toBe(200);
    expect(itemsModule.markLoungeItemRead).toHaveBeenCalledWith(expect.anything(), "i1");
    expect((await readAll(req(), { params: { gameId: "g1" } })).status).toBe(200);
    expect(itemsModule.markAllLoungeItemsRead).toHaveBeenCalledWith(expect.anything(), "g1");
  });

  it("returns 500 when saving fails", async () => {
    vi.mocked(itemsModule.markLoungeItemRead).mockResolvedValue(false);
    expect((await readOne(req(), { params: { id: "i1" } })).status).toBe(500);
  });
});
