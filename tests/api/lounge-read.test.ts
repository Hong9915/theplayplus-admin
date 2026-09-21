import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as readOne } from "@/app/api/lounge/items/[id]/read/route";
import { POST as readAll } from "@/app/api/games/[gameId]/lounge/read-all/route";
import * as sessionModule from "@/lib/require-admin-session";
import * as itemsModule from "@/lib/lounge-items";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn(() => ({})) }));
vi.mock("@/lib/require-admin-session", () => ({ requireAdminSession: vi.fn() }));
vi.mock("@/lib/lounge-items", () => ({ markLoungeItemRead: vi.fn(), markAllLoungeItemsRead: vi.fn() }));

const req = () => new Request("https://admin.example/x", { method: "POST" });
const ID = "6f1a1e9c-0b2f-4f4e-9c0d-1a2b3c4d5e6f";

describe("lounge read routes", () => {
  beforeEach(() => {
    vi.mocked(sessionModule.requireAdminSession).mockResolvedValue(true);
    vi.mocked(itemsModule.markLoungeItemRead).mockReset().mockResolvedValue(true);
    vi.mocked(itemsModule.markAllLoungeItemsRead).mockReset().mockResolvedValue(true);
  });

  it("requires an admin session", async () => {
    vi.mocked(sessionModule.requireAdminSession).mockResolvedValue(false);
    expect((await readOne(req(), { params: { id: ID } })).status).toBe(401);
    expect((await readAll(req(), { params: { gameId: "g1" } })).status).toBe(401);
    expect(itemsModule.markLoungeItemRead).not.toHaveBeenCalled();
  });

  it("marks one item and all items of a game as read", async () => {
    expect((await readOne(req(), { params: { id: ID } })).status).toBe(200);
    expect(itemsModule.markLoungeItemRead).toHaveBeenCalledWith(expect.anything(), ID);
    expect((await readAll(req(), { params: { gameId: "g1" } })).status).toBe(200);
    expect(itemsModule.markAllLoungeItemsRead).toHaveBeenCalledWith(expect.anything(), "g1");
  });

  it("rejects an id that is not a uuid before touching the db", async () => {
    const response = await readOne(req(), { params: { id: "i1; drop" } });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: "invalid_id" });
    expect(itemsModule.markLoungeItemRead).not.toHaveBeenCalled();
  });

  it("returns 500 when saving fails", async () => {
    vi.mocked(itemsModule.markLoungeItemRead).mockResolvedValue(false);
    expect((await readOne(req(), { params: { id: ID } })).status).toBe(500);
  });
});
