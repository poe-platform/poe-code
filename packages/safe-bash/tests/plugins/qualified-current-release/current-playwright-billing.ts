import type { PlaywrightInjectionOptions, BrowserUsageEvent, PlaywrightBillingHooks, PlaywrightUsageAdapter } from "@poe-platform/safe-bash/contracts/playwright";

// A host integration consumes the declarations without running browser effects.
export async function acquireForHost(options: PlaywrightInjectionOptions, request: Parameters<typeof options.adapter.acquire>[0]) {
  if (options.billing === undefined) return options.adapter.acquire(request);
  await options.billing.beforeAcquire?.(request);
  return options.adapter.acquire({
    ...request,
    usage: { intervalMs: options.billing.intervalMs, report: options.billing.onUsage.bind(options.billing) },
  });
}

// Declaration consumers only. These facts are never delivered to a real hook.
const identity = { acquisitionId: "attempt-1", resourceId: "browser-1", observedAt: "2026-09-16T12:00:00.000Z" };
export const durationFacts = [
  { ...identity, eventId: "start", revision: 1, type: "started", startedAt: identity.observedAt, accuracy: "estimated" },
  { ...identity, eventId: "idle", revision: 2, type: "usage", cumulativeBrowserMs: 1000, through: identity.observedAt, accuracy: "estimated", final: false },
  { ...identity, eventId: "idle", revision: 2, type: "usage", cumulativeBrowserMs: 1000, through: identity.observedAt, accuracy: "estimated", final: false },
  { ...identity, eventId: "lost", revision: 3, type: "unknown", reason: "connection-lost" },
  { ...identity, eventId: "partial", revision: 4, type: "usage", cumulativeBrowserMs: 1250, through: identity.observedAt, accuracy: "provider", final: true },
  { ...identity, eventId: "end", revision: 5, type: "ended", cumulativeBrowserMs: 1250, endedAt: identity.observedAt, accuracy: "provider" },
  { ...identity, eventId: "correction", revision: 6, type: "usage", cumulativeBrowserMs: 900, through: identity.observedAt, accuracy: "provider", final: true },
] satisfies BrowserUsageEvent[];

// Compile rejection controls; this function is not executed by a runtime route.
export function qualifyInjection(adapter: PlaywrightInjectionOptions["adapter"], reporting: PlaywrightUsageAdapter, billing: PlaywrightBillingHooks) {
  const ordinary = { adapter } satisfies PlaywrightInjectionOptions;
  const enabled = { adapter: reporting, billing } satisfies PlaywrightInjectionOptions;
  // @ts-expect-error Ordinary adapters cannot promise live duration reporting.
  const unsupported: PlaywrightInjectionOptions = { adapter, billing };
  // @ts-expect-error Unknown lifetime cannot fabricate a final duration.
  const unknown: BrowserUsageEvent = { ...identity, eventId: "unknown", revision: 7, type: "unknown", reason: "cleanup-failed", cumulativeBrowserMs: 0 };
  return [ordinary, enabled, unsupported, unknown];
}
