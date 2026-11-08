export function stampReceiveTime(event, ts) {
  if (event === null || typeof event !== "object") {
    return event;
  }
  const target = event;
  const existing = target._meta;
  if (existing && typeof existing.ts === "number") {
    return event;
  }
  target._meta = existing ? { ...existing, ts } : { ts };
  return event;
}
