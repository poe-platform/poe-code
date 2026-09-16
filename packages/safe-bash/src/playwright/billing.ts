import type { PlaywrightAcquireOptions, PlaywrightAdapter, PlaywrightLease } from "./adapter.js";

export type {
  BrowserEngine,
  PlaywrightAcquireOptions,
  PlaywrightAdapter,
  PlaywrightBrowser,
  PlaywrightContext,
  PlaywrightLease,
  PlaywrightLocator,
  PlaywrightPage,
} from "./adapter.js";

/** Live browser milliseconds including idle time. See playwright.md for obligations. */
export type BrowserUsageEvent = {
  /** Stable across delivery retries. */
  readonly eventId: string;
  readonly acquisitionId: string;
  /** Billable browser identity, stable across reconnects; not a tab or lease ID. */
  readonly resourceId: string;
  /** Positive integer ordered per resource; corrections advance it. */
  readonly revision: number;
  /** UTC ISO observation timestamp, distinct from resource timestamps. */
  readonly observedAt: string;
} & (
  | {
      readonly type: "started";
      readonly startedAt: string;
      readonly accuracy: "provider" | "estimated";
    }
  | {
      readonly type: "usage";
      /** Finite nonnegative, unrounded duration from resource start. */
      readonly cumulativeBrowserMs: number;
      readonly through: string;
      readonly accuracy: "provider" | "estimated";
      /** True only after confirmed resource end, including the last partial interval. */
      readonly final: boolean;
    }
  | {
      readonly type: "ended";
      readonly endedAt: string;
      /** Final cumulative duration after confirmed end; not another charge quantity. */
      readonly cumulativeBrowserMs: number;
      readonly accuracy: "provider" | "estimated";
    }
  | {
      readonly type: "unknown";
      readonly reason: "acquisition-failed" | "connection-lost" | "cleanup-failed";
    }
);

/** Trusted injected host hooks; identity, pricing and charging remain external. */
export interface PlaywrightBillingHooks {
  /** Caller-selected finite positive integer; validate before effects. No default. */
  readonly intervalMs: number;
  /** Await before allocation. Rejection prevents browser effects. */
  beforeAcquire?(request: PlaywrightAcquireOptions): Promise<void>;
  /** Await serialized cumulative/lifecycle reports; rejection requires owned cleanup. */
  onUsage(event: BrowserUsageEvent): Promise<void>;
}

export interface PlaywrightUsageConfiguration {
  /** Caller-selected finite positive integer, validated before allocation. */
  readonly intervalMs: number;
  /** Await per resource; coalesce slow ticks and preserve final/lifecycle facts. */
  report(event: BrowserUsageEvent): Promise<void>;
}

export interface PlaywrightUsageAcquireOptions extends PlaywrightAcquireOptions {
  /** Adapter reporting continues between commands, including partial acquisition. */
  readonly usage?: PlaywrightUsageConfiguration;
}

/**
 * Injection obligation only; the current adapter factory does not implement it.
 * Must honor playwright.md, without keep-alives or extending service lifetime.
 */
export interface PlaywrightUsageAdapter extends PlaywrightAdapter {
  readonly liveBrowserUsage: true;
  acquire(options: PlaywrightUsageAcquireOptions): Promise<PlaywrightLease>;
}

/** Billing requires an explicitly reporting-capable injected adapter. */
export type PlaywrightInjectionOptions =
  | { readonly adapter: PlaywrightAdapter; readonly billing?: undefined }
  | { readonly adapter: PlaywrightUsageAdapter; readonly billing: PlaywrightBillingHooks };
