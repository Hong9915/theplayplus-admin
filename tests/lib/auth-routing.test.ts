import { describe, it, expect } from "vitest";
import { resolveAdminAuthRedirect } from "@/lib/auth-routing";

describe("resolveAdminAuthRedirect", () => {
  it("redirects an unauthenticated visitor away from a protected path", () => {
    expect(resolveAdminAuthRedirect("/games", false)).toBe("/login");
  });

  it("redirects an unauthenticated visitor away from a nested protected path", () => {
    expect(resolveAdminAuthRedirect("/inquiries/abc-123", false)).toBe("/login");
  });

  it("does not redirect an unauthenticated visitor already on /login", () => {
    expect(resolveAdminAuthRedirect("/login", false)).toBeNull();
  });

  it("does not redirect an authenticated visitor on a protected path", () => {
    expect(resolveAdminAuthRedirect("/games", true)).toBeNull();
  });

  it("redirects an authenticated visitor away from /login", () => {
    expect(resolveAdminAuthRedirect("/login", true)).toBe("/games");
  });
});
