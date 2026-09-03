import { yieldTurn } from "../../../contracts/yield.js";
import { EreProfileLimitError, EreUsageUnknownError } from "./errors.js";
import type { EreExpansionBounds, EreLimits, EreResource, EreUsage } from "./types.js";

const resources: readonly EreResource[] = Object.freeze([
  "patternBytes", "subjectBytes", "work", "states", "allocationUnits", "captureBytes", "captureSlots",
]);

function integer(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("ERE bounds must be nonnegative safe integers");
}

function multiply(value: number, factor: number, ceiling: number): number {
  return value > Math.floor(ceiling / factor) ? ceiling : value * factor;
}

export function deriveEreLimits(bounds: EreExpansionBounds): EreLimits {
  integer(bounds.maxExpansionBytes);
  integer(bounds.maxExpansionFields);
  const bytes = bounds.maxExpansionBytes;
  const fields = bounds.maxExpansionFields;
  const byteUnits = multiply(bytes, 8, 4_000_000);
  const fieldUnits = multiply(fields, 128, 4_000_000);
  return Object.freeze({
    patternBytes: Math.min(bytes, 65_536),
    subjectBytes: Math.min(bytes, 1_048_576),
    work: multiply(bytes, 32, 50_000_000),
    states: multiply(fields, 8, 65_536),
    allocationUnits: byteUnits >= 4_000_000 - fieldUnits ? 4_000_000 : byteUnits + fieldUnits,
    captureBytes: bytes,
    captureSlots: fields,
  });
}

export class EreLedger {
  readonly limits: EreLimits;
  #usage: Record<EreResource, number> = {
    patternBytes: 0, subjectBytes: 0, work: 0, states: 0, allocationUnits: 0, captureBytes: 0, captureSlots: 0,
  };
  #poison: EreUsageUnknownError | undefined;
  #lastYield = 0;

  constructor(bounds: EreExpansionBounds, lowering: Partial<EreLimits> = {}) {
    const limits = { ...deriveEreLimits(bounds) };
    for (const resource of Object.keys(lowering)) {
      if (!resources.includes(resource as EreResource)) throw new TypeError("unknown ERE limit");
      const key = resource as EreResource;
      const value = lowering[key];
      if (value === undefined) throw new TypeError("undefined ERE limit");
      integer(value);
      if (value > limits[key]) throw new RangeError("ERE limits may only be lowered");
      limits[key] = value;
    }
    this.limits = Object.freeze(limits);
  }

  get usage(): EreUsage { return Object.freeze({ ...this.#usage }); }

  check(signal?: AbortSignal): void {
    if (signal?.aborted) throw signal.reason;
    if (this.#poison) throw this.#poison;
  }

  charge(resource: EreResource, amount: number, signal?: AbortSignal): void {
    this.check(signal);
    integer(amount);
    if (amount > this.limits[resource] - this.#usage[resource]) {
      throw new EreProfileLimitError(resource, this.limits[resource]);
    }
    this.#usage[resource] += amount;
  }

  admitInput(resource: "patternBytes" | "subjectBytes", length: number, signal?: AbortSignal): void {
    this.check(signal);
    integer(length);
    if (length > this.limits[resource]) throw new EreProfileLimitError(resource, this.limits[resource]);
    this.#usage[resource] = Math.max(this.#usage[resource], length);
  }

  async checkpoint(signal?: AbortSignal): Promise<void> {
    this.check(signal);
    if (this.#usage.work - this.#lastYield >= 256) {
      this.#lastYield = this.#usage.work;
      await yieldTurn(signal);
      this.check(signal);
    }
  }

  markUnknownUsage(reason: unknown): void {
    this.#poison ??= new EreUsageUnknownError(reason);
  }
}
