import { yieldTurn } from "../../../contracts/yield.js";
import { EreProfileLimitError, EreUsageUnknownError } from "./errors.js";
import type { EreExpansionBounds, EreLimits, EreResource, EreUsage } from "./types.js";

const resources: readonly EreResource[] = Object.freeze([
  "patternBytes", "subjectBytes", "work", "states", "allocationUnits", "captureBytes", "captureSlots",
]);

function integer(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("ERE bounds must be nonnegative safe integers");
}

export function deriveEreLimits(bounds: EreExpansionBounds): EreLimits {
  if (bounds.maxExpansionBytes !== Infinity) integer(bounds.maxExpansionBytes);
  if (bounds.maxExpansionFields !== Infinity) integer(bounds.maxExpansionFields);
  return Object.freeze({
    patternBytes: Infinity, subjectBytes: Infinity, work: Infinity,
    states: Infinity, allocationUnits: Infinity, captureBytes: bounds.maxExpansionBytes,
    captureSlots: bounds.maxExpansionFields,
  });
}

export class EreLedger {
  readonly limits: EreLimits;
  #usage: Record<EreResource, number> = {
    patternBytes: 0, subjectBytes: 0, work: 0, states: 0, allocationUnits: 0, captureBytes: 0, captureSlots: 0,
  };
  #poison: EreUsageUnknownError | undefined;
  #lastYield = 0;

  constructor(bounds: EreExpansionBounds, overrides: Partial<EreLimits> = {}) {
    const limits = { ...deriveEreLimits(bounds) };
    for (const resource of Object.keys(overrides)) {
      if (!resources.includes(resource as EreResource)) throw new TypeError("unknown ERE limit");
      const key = resource as EreResource;
      const value = overrides[key];
      if (value === undefined) throw new TypeError("undefined ERE limit");
      if (value !== Infinity) integer(value);
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

  chargeWork(amount: number, signal?: AbortSignal): void {
    if (signal?.aborted) throw signal.reason;
    if (this.#poison) throw this.#poison;
    if (amount > this.limits.work - this.#usage.work) {
      throw new EreProfileLimitError("work", this.limits.work);
    }
    this.#usage.work += amount;
  }

  workAllowanceUntilCheckpoint(): number {
    const untilLimit = this.limits.work - this.#usage.work;
    const untilYield = 256 - (this.#usage.work - this.#lastYield);
    const min = untilLimit < untilYield ? untilLimit : untilYield;
    return min > 0 ? min : 0;
  }

  admitInput(resource: "patternBytes" | "subjectBytes", length: number, signal?: AbortSignal): void {
    this.check(signal);
    integer(length);
    if (length > this.limits[resource]) throw new EreProfileLimitError(resource, this.limits[resource]);
    this.#usage[resource] = Math.max(this.#usage[resource], length);
  }

  checkpoint(signal?: AbortSignal): Promise<void> | undefined {
    this.check(signal);
    if (this.#usage.work - this.#lastYield >= 256) {
      this.#lastYield = this.#usage.work;
      return yieldTurn(signal).then(() => {
        this.check(signal);
      });
    }
    return undefined;
  }

  markUnknownUsage(reason: unknown): void {
    this.#poison ??= new EreUsageUnknownError(reason);
  }
}
