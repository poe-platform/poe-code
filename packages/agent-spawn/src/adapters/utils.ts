export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  if (maxLength <= 3) return text.slice(0, maxLength);
  return `${text.slice(0, maxLength - 3)}...`;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function extractThreadId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return;

  const obj = value as Record<string, unknown>;
  const maybeThreadId =
    (isNonEmptyString(obj.thread_id) && obj.thread_id) ||
    (isNonEmptyString(obj.threadId) && obj.threadId) ||
    (isNonEmptyString(obj.threadID) && obj.threadID) ||
    (isNonEmptyString(obj.session_id) && obj.session_id) ||
    (isNonEmptyString(obj.sessionId) && obj.sessionId) ||
    (isNonEmptyString(obj.sessionID) && obj.sessionID);

  return maybeThreadId || undefined;
}
