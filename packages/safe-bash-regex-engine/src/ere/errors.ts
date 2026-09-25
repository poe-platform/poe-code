import type { EreResource } from "./types.js";

export class EreSyntaxError extends Error {
  readonly status = 2;
  constructor(message: string, readonly offset: number) {
    super(`invalid ERE at ${offset}: ${message}`);
    this.name = "EreSyntaxError";
  }
}

export class EreUnsupportedError extends Error {
  readonly status = 2;
  constructor(message: string, readonly offset: number) {
    super(`unsupported ERE profile at ${offset}: ${message}`);
    this.name = "EreUnsupportedError";
  }
}

export class EreProfileLimitError extends Error {
  readonly status = 3;
  constructor(readonly resource: EreResource, readonly limit: number) {
    super(`ERE profile limit exceeded: ${resource} (${limit})`);
    this.name = "EreProfileLimitError";
  }
}

export class EreUsageUnknownError extends Error {
  readonly status = 3;
  constructor(reason: unknown) {
    super("ERE invocation usage is unknown; further work is refused", { cause: reason });
    this.name = "EreUsageUnknownError";
  }
}
