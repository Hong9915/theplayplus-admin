const PUBLIC_PATHS = ["/login"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function resolveAdminAuthRedirect(pathname: string, isAuthenticated: boolean): string | null {
  if (!isAuthenticated && !isPublicPath(pathname)) {
    return "/login";
  }
  if (isAuthenticated && pathname === "/login") {
    return "/games";
  }
  return null;
}
