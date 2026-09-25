import { hasYieldCheckpoint, monotonicNow, runYieldCheckpoint, yieldTurn } from "../../../contracts/yield.js";
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
  private limitWorkSmi = 0x3fffffff;
  private uPatternBytes = 0;
  private uSubjectBytes = 0;
  private uWork = 0;
  private uStates = 0;
  private uAllocationUnits = 0;
  private uCaptureBytes = 0;
  private uCaptureSlots = 0;
  private poison: EreUsageUnknownError | undefined;
  private lastYield = 0;
  private lastYieldMs = 0;

  constructor(bounds: EreExpansionBounds, overrides?: Partial<EreLimits>, prevalidated?: EreLimits) {
    if (prevalidated !== undefined) {
      this.limits = prevalidated;
      this.limitWorkSmi = prevalidated.work > 0x3fffffff ? 0x3fffffff : (prevalidated.work | 0);
      return;
    }
    const limits = { ...deriveEreLimits(bounds) };
    if (overrides !== undefined) {
      for (const resource of Object.keys(overrides)) {
        if (!resources.includes(resource as EreResource)) throw new TypeError("unknown ERE limit");
        const key = resource as EreResource;
        const value = overrides[key];
        if (value === undefined) throw new TypeError("undefined ERE limit");
        if (value !== Infinity) integer(value);
        limits[key] = value;
      }
    }
    this.limits = Object.freeze(limits);
    this.limitWorkSmi = limits.work > 0x3fffffff ? 0x3fffffff : (limits.work | 0);
  }

  resetWithLimits(limits: EreLimits): this {
    (this as { limits: EreLimits }).limits = limits;
    this.limitWorkSmi = limits.work > 0x3fffffff ? 0x3fffffff : (limits.work | 0);
    this.uPatternBytes = 0;
    this.uSubjectBytes = 0;
    this.uWork = 0;
    this.uStates = 0;
    this.uAllocationUnits = 0;
    this.uCaptureBytes = 0;
    this.uCaptureSlots = 0;
    this.poison = undefined;
    this.lastYield = 0;
    this.lastYieldMs = 0;
    return this;
  }

  static withPrevalidatedLimits(limits: EreLimits): EreLedger {
    return new EreLedger({ maxExpansionBytes: Infinity, maxExpansionFields: Infinity }, undefined, limits);
  }

  get usage(): EreUsage {
    return Object.freeze({
      patternBytes: this.uPatternBytes,
      subjectBytes: this.uSubjectBytes,
      work: this.uWork,
      states: this.uStates,
      allocationUnits: this.uAllocationUnits,
      captureBytes: this.uCaptureBytes,
      captureSlots: this.uCaptureSlots,
    });
  }

  private getResource(resource: EreResource): number {
    switch (resource) {
      case "patternBytes": return this.uPatternBytes;
      case "subjectBytes": return this.uSubjectBytes;
      case "work": return this.uWork;
      case "states": return this.uStates;
      case "allocationUnits": return this.uAllocationUnits;
      case "captureBytes": return this.uCaptureBytes;
      case "captureSlots": return this.uCaptureSlots;
    }
  }

  private addResource(resource: EreResource, amount: number): void {
    const amtSmi = amount | 0;
    switch (resource) {
      case "patternBytes": this.uPatternBytes = amtSmi === amount && this.uPatternBytes + amtSmi <= 0x3fffffff ? (this.uPatternBytes + amtSmi) | 0 : this.uPatternBytes + amount; break;
      case "subjectBytes": this.uSubjectBytes = amtSmi === amount && this.uSubjectBytes + amtSmi <= 0x3fffffff ? (this.uSubjectBytes + amtSmi) | 0 : this.uSubjectBytes + amount; break;
      case "work": this.uWork = amtSmi === amount && this.uWork + amtSmi <= 0x3fffffff ? (this.uWork + amtSmi) | 0 : this.uWork + amount; break;
      case "states": this.uStates = amtSmi === amount && this.uStates + amtSmi <= 0x3fffffff ? (this.uStates + amtSmi) | 0 : this.uStates + amount; break;
      case "allocationUnits": this.uAllocationUnits = amtSmi === amount && this.uAllocationUnits + amtSmi <= 0x3fffffff ? (this.uAllocationUnits + amtSmi) | 0 : this.uAllocationUnits + amount; break;
      case "captureBytes": this.uCaptureBytes = amtSmi === amount && this.uCaptureBytes + amtSmi <= 0x3fffffff ? (this.uCaptureBytes + amtSmi) | 0 : this.uCaptureBytes + amount; break;
      case "captureSlots": this.uCaptureSlots = amtSmi === amount && this.uCaptureSlots + amtSmi <= 0x3fffffff ? (this.uCaptureSlots + amtSmi) | 0 : this.uCaptureSlots + amount; break;
    }
  }

  check(signal?: AbortSignal): void {
    if (signal?.aborted) throw signal.reason;
    if (this.poison) throw this.poison;
  }

  charge(resource: EreResource, amount: number, signal?: AbortSignal): void {
    this.check(signal);
    integer(amount);
    const current = this.getResource(resource);
    const limit = this.limits[resource];
    if (limit !== Infinity && amount > limit - current) {
      throw new EreProfileLimitError(resource, limit);
    }
    this.addResource(resource, amount);
  }

  chargeWork(amount: number, signal?: AbortSignal): void {
    if (signal?.aborted) throw signal.reason;
    if (this.poison) throw this.poison;
    if (amount > this.limitWorkSmi - this.uWork && amount > this.limits.work - this.uWork) {
      throw new EreProfileLimitError("work", this.limits.work);
    }
    const amtSmi = amount | 0;
    this.uWork = amtSmi === amount && this.uWork + amtSmi <= 0x3fffffff ? (this.uWork + amtSmi) | 0 : this.uWork + amount;
  }

  workAllowanceUntilCheckpoint(signal?: AbortSignal): number {
    const untilLimit = (this.limitWorkSmi - (this.uWork | 0)) | 0;
    const interval = hasYieldCheckpoint(signal) ? 256 : 16384;
    const untilYield = (interval - ((this.uWork | 0) - (this.lastYield | 0))) | 0;
    const min = untilLimit < untilYield ? untilLimit : untilYield;
    return min > 0 ? min : 0;
  }

  admitInput(resource: "patternBytes" | "subjectBytes", length: number, signal?: AbortSignal): void {
    this.check(signal);
    integer(length);
    if (length > this.limits[resource]) throw new EreProfileLimitError(resource, this.limits[resource]);
    if (resource === "patternBytes") this.uPatternBytes = Math.max(this.uPatternBytes, length);
    else this.uSubjectBytes = Math.max(this.uSubjectBytes, length);
  }

  checkpoint(signal?: AbortSignal): Promise<void> | undefined {
    runYieldCheckpoint(signal);
    this.check(signal);
    const hasExt = hasYieldCheckpoint(signal);
    const interval = hasExt ? 256 : 16384;
    if (this.uWork - this.lastYield >= interval) {
      this.lastYield = this.uWork;
      // A supplied signal must remain observable at each work checkpoint.
      if (!hasExt && signal === undefined) {
        const now = monotonicNow();
        if (this.lastYieldMs === 0) {
          this.lastYieldMs = now;
          return undefined;
        }
        if (now - this.lastYieldMs < 25) return undefined;
        this.lastYieldMs = now;
      }
      return yieldTurn(signal).then(() => {
        this.check(signal);
      });
    }
    return undefined;
  }

  markUnknownUsage(reason: unknown): void {
    this.poison ??= new EreUsageUnknownError(reason);
  }
}
