const publicPaths = new Set(["/login", "/auth/callback", "/auth/google"]);
const onboardingPaths = new Set([
  "/connect-silpo",
  "/auth/silpo/start",
  "/auth/silpo/callback",
]);
const authenticatedPaths = new Set(["/auth/logout"]);

export function authDestination(
  path: string,
  authenticated: boolean,
  silpoConnected: boolean,
) {
  if (!authenticated) return publicPaths.has(path) ? null : "/login";
  if (authenticatedPaths.has(path) || path.startsWith("/api/")) return null;
  if (path === "/login") return silpoConnected ? "/" : "/connect-silpo";
  if (onboardingPaths.has(path)) return silpoConnected ? "/" : null;
  return silpoConnected ? null : "/connect-silpo";
}
