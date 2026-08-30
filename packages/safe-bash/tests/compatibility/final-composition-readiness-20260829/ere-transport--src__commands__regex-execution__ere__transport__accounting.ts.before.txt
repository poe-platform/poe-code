import { deriveEreLimits } from "../limits.js";
import type { EreExpansionBounds, EreLimits, EreResource, EreUsage } from "../types.js";
import { cumulative, EreTransportError, EreTransportProfileLimitError, resources } from "./protocol.js";

export function integer(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) throw new EreTransportError("PROTOCOL", "invalid finite transport integer");
}

export function add(left: number, right: number): number {
  integer(left); integer(right);
  if (left > Number.MAX_SAFE_INTEGER - right) throw new EreTransportError("PROTOCOL", "transport arithmetic overflow");
  return left + right;
}

export function multiply(value: number, factor: number): number {
  integer(value); integer(factor);
  if (factor !== 0 && value > Math.floor(Number.MAX_SAFE_INTEGER / factor)) throw new EreTransportError("PROTOCOL", "transport arithmetic overflow");
  return value * factor;
}

export const metadataUnits = Object.freeze({
  root: 18 + 5 + 7 + 3 + 8 + 8 + 2 + 10,
  session: 3 + 2,
  ticket: 16 + 1 + 4 + 3 + 2 + 4 + 4,
  worker: 21 + 15 + 4 + 28,
  usage: 3 + 8 + 5,
});

export function assertBootstrapStorage(bounds: EreExpansionBounds, units: number): void {
  integer(bounds.maxExpansionBytes); integer(bounds.maxExpansionFields); integer(units);
  const byteUnits = bounds.maxExpansionBytes > 500_000 ? 4_000_000 : bounds.maxExpansionBytes * 8;
  const fieldUnits = bounds.maxExpansionFields > 31_250 ? 4_000_000 : bounds.maxExpansionFields * 128;
  const limit = Math.min(4_000_000, byteUnits + fieldUnits);
  if (add(units, 5) > limit) throw new EreTransportProfileLimitError("transportStorage", limit);
  const work = bounds.maxExpansionBytes > 1_562_500 ? 50_000_000 : bounds.maxExpansionBytes * 32;
  if (add(units, 5) > work) throw new EreTransportProfileLimitError("transportWork", work);
}

function zero(): Record<EreResource, number> {
  return { patternBytes: 0, subjectBytes: 0, work: 0, states: 0, allocationUnits: 0, captureBytes: 0, captureSlots: 0 };
}

export class EngineAccounting {
  readonly limits: EreLimits;
  #spent = zero();
  #active: EreLimits | undefined;
  #poisoned = false;
  constructor(bounds: EreExpansionBounds) { this.limits = deriveEreLimits(bounds); }
  get usage(): EreUsage { return Object.freeze({ ...this.#spent }); }
  reserve(patternBytes: number, subjectBytes: number): EreLimits {
    if (this.#poisoned || this.#active) throw new EreTransportError("CLOSED", "engine grant unavailable");
    integer(patternBytes); integer(subjectBytes);
    if (patternBytes > this.limits.patternBytes || subjectBytes > this.limits.subjectBytes) throw new EreTransportError("PROTOCOL", "unadmitted engine input");
    const allowance = { ...this.limits };
    for (const resource of cumulative) allowance[resource] -= this.#spent[resource];
    this.#spent.patternBytes = Math.max(this.#spent.patternBytes, patternBytes);
    this.#spent.subjectBytes = Math.max(this.#spent.subjectBytes, subjectBytes);
    this.#active = Object.freeze(allowance);
    return this.#active;
  }
  commit(allowance: EreLimits, usage: EreUsage): void {
    if (allowance !== this.#active) throw new EreTransportError("PROTOCOL", "grant already reconciled or foreign");
    for (const resource of resources) {
      integer(usage[resource]);
      if (usage[resource] > allowance[resource]) throw new EreTransportError("PROTOCOL", "over-grant usage");
    }
    for (const resource of cumulative) this.#spent[resource] += usage[resource];
    this.#active = undefined;
  }
  abandon(allowance: EreLimits, sent: boolean): void {
    if (allowance !== this.#active) throw new EreTransportError("PROTOCOL", "foreign abandoned grant");
    if (sent) {
      for (const resource of cumulative) this.#spent[resource] += allowance[resource];
      this.#poisoned = true;
    }
    this.#active = undefined;
  }
}

export class StorageReservation {
  #remaining: number;
  #live = 5;
  #released = false;
  constructor(readonly ledger: TransportAccounting, units: number) { this.#remaining = units; }
  consume(units: number): void {
    integer(units);
    if (this.#released || units > this.#remaining) throw new EreTransportError("PROTOCOL", "invalid transport reservation spend");
    this.#remaining -= units;
    this.#live += units;
    this.ledger.spend(units);
  }
  settle(actual: number): void { this.consume(actual); this.releaseUnused(); }
  unknown(): void { this.consume(this.#remaining); this.releaseUnused(); }
  releaseUnused(): void {
    if (this.#released) return;
    this.#released = true;
    this.ledger.unreserve(this.#remaining);
    this.#remaining = 0;
  }
  retire(): void {
    this.ledger.retire(this.#live);
    this.#live = 0;
  }
}

export class TransportAccounting {
  readonly storageLimit: number;
  readonly workLimit: number;
  #spent = 0;
  #reserved = 0;
  #live = 0;
  #work = 0;
  constructor(limits: EreLimits) { this.storageLimit = limits.allocationUnits; this.workLimit = limits.work; }
  get available(): number { return this.storageLimit - this.#spent - this.#reserved; }
  get usage(): Readonly<{ spent: number; reserved: number; live: number; work: number }> { return Object.freeze({ spent: this.#spent, reserved: this.#reserved, live: this.#live, work: this.#work }); }
  visit(units: number): void {
    integer(units);
    if (units > this.workLimit - this.#work) throw new EreTransportProfileLimitError("transportWork", this.workLimit);
    this.#work += units;
  }
  metadata(fields: number): StorageReservation { return this.owned(add(1, fields)); }
  owned(units: number): StorageReservation {
    this.visit(units);
    const reservation = this.reserve(units);
    reservation.consume(units);
    reservation.releaseUnused();
    return reservation;
  }
  reserve(units: number): StorageReservation {
    integer(units);
    const tokenUnits = 5;
    if (add(units, tokenUnits) > this.available) throw new EreTransportProfileLimitError("transportStorage", this.storageLimit);
    this.visit(tokenUnits);
    this.#spent += tokenUnits;
    this.#live += tokenUnits;
    this.#reserved += units;
    return new StorageReservation(this, units);
  }
  spend(units: number): void {
    if (units > this.#reserved) throw new EreTransportError("PROTOCOL", "transport reservation underflow");
    this.#reserved -= units; this.#spent += units; this.#live += units;
  }
  unreserve(units: number): void { if (units > this.#reserved) throw new EreTransportError("PROTOCOL", "transport reservation underflow"); this.#reserved -= units; }
  retire(units: number): void { if (units > this.#live) throw new EreTransportError("PROTOCOL", "transport ownership underflow"); this.#live -= units; }
}
