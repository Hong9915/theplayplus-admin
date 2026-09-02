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

describe("getAdminSession", () => {
  beforeEach(() => {
    createServerClientMock.mockClear();
    getUserMock.mockReset();
    cookiesGetMock.mockReset();
  });

  it("returns the id and email of the authenticated user", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1", email: "info@theplayplus.com" } } });
    const { getAdminSession } = await import("@/lib/require-admin-session");

    await expect(getAdminSession()).resolves.toEqual({ id: "user-1", email: "info@theplayplus.com" });
  });

  it("returns null when there is no user", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const { getAdminSession } = await import("@/lib/require-admin-session");

    await expect(getAdminSession()).resolves.toBeNull();
  });

  it("falls back to the user id when the account has no email", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    const { getAdminSession } = await import("@/lib/require-admin-session");

    await expect(getAdminSession()).resolves.toEqual({ id: "user-1", email: "user-1" });
  });
});
