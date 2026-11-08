import { native } from "./native.js";
export const truncate = native.spawnTruncate,
  isNonEmptyString = native.spawnIsNonempty;
export function extractThreadId(value) {
  if (value === null || typeof value !== "object") return undefined;
  for (const key of ["thread_id", "threadId", "threadID", "session_id", "sessionId", "sessionID"])
    if (isNonEmptyString(value[key])) {
      const candidate = value[key];
      if (candidate) return candidate;
    }
  return undefined;
}
