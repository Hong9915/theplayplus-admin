import { describe, it, expect, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
const createServerClientMock = vi.fn().mockReturnValue({ auth: { getUser: getUserMock } });
const cookiesGetMock = vi.fn();

vi.mock("next/headers", () => ({
  cookies: () => ({ get: cookiesGetMock }),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: createServerClientMock,
}));

describe("requireAdminSession", () => {
  beforeEach(() => {
    createServerClientMock.mockClear();
    getUserMock.mockReset();
    cookiesGetMock.mockReset();
  });

  it("returns true when getUser resolves an authenticated user", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    const { requireAdminSession } = await import("@/lib/require-admin-session");

    await expect(requireAdminSession()).resolves.toBe(true);
  });

  it("returns false when getUser resolves no user", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const { requireAdminSession } = await import("@/lib/require-admin-session");

    await expect(requireAdminSession()).resolves.toBe(false);
  });
});
