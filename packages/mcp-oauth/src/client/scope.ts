/** Compare OAuth scope sets without accepting controls or changing token case. */
export function normalizeOAuthScope(scope: unknown): string | undefined {
  if (scope === undefined) return undefined;
  if (typeof scope !== "string" || [...scope].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) > 126 || char === '"' || char === "\\"))
    throw new Error("Invalid OAuth scope syntax");
  const normalized = [...new Set(scope.split(" ").filter(Boolean))].sort().join(" ");
  return normalized || undefined;
}
