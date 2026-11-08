export function assertSafeSessionId(sessionId: unknown): asserts sessionId is string {
  if (
    typeof sessionId !== "string" ||
    sessionId.trim().length === 0 ||
    sessionId === "." ||
    sessionId === ".." ||
    sessionId.includes("/") ||
    sessionId.includes("\\")
  ) {
    throw new Error(`Invalid poe-agent session id: ${String(sessionId)}`);
  }
}
