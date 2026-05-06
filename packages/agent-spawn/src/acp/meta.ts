export function stampReceiveTime<E>(event: E, ts: number): E {
  if (event === null || typeof event !== "object") {
    return event;
  }

  const target = event as { _meta?: Record<string, unknown> };
  const existing = target._meta;
  if (existing && typeof existing.ts === "number") {
    return event;
  }

  target._meta = existing ? { ...existing, ts } : { ts };
  return event;
}
