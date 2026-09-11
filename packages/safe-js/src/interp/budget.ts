import { replaceErrorStack } from "../error/shape.js";
import { releaseTemplateObjects } from "./template-cache.js";

export type BudgetName =
  | "steps"
  | "deadline"
  | "callDepth"
  | "stringLength"
  | "arrayLength"
  | "dataSize"
  | "dataDepth";

export type BudgetOptions = {
  maxSteps?: number;
  deadline?: number | Date;
  maxCallDepth?: number;
  stringLength?: number;
  arrayLength?: number;
  dataSize?: number;
};

export const REGEX_STEP_LIMIT = 2_000;
export const REGEX_COMPILE_LIMITS = Object.freeze({
  sourceLength: 4_096,
  flagsLength: 8,
  depth: 64,
  allocations: 16_384
});
const DEADLINE_CHECK_INTERVAL = 1_024;

export class SandboxError extends Error {
  readonly code: "aborted" | "budgetExceeded" | "reentry";
  readonly budget?: BudgetName;
  readonly current?: number;
  readonly limit?: number;

  constructor(input: "aborted");
  constructor(input: "reentry");
  constructor(input: { budget: BudgetName; current: number; limit: number });
  constructor(
    input: "aborted" | "reentry" | { budget: BudgetName; current: number; limit: number }
  ) {
    super(
      input === "aborted"
        ? "aborted"
        : input === "reentry"
          ? "Sandbox object is already running."
          : `Sandbox budget exceeded for ${input.budget}: ${input.current} > ${input.limit}.`
    );
    this.name = "SandboxError";
    replaceErrorStack(this);

    if (input === "aborted") {
      this.code = "aborted";
      return;
    }

    if (input === "reentry") {
      this.code = "reentry";
      return;
    }

    this.code = "budgetExceeded";
    this.budget = input.budget;
    this.current = input.current;
    this.limit = input.limit;
  }
}

type BudgetLimits = {
  maxSteps?: number;
  maxCallDepth?: number;
  stringLength?: number;
  arrayLength?: number;
  dataSize?: number;
};

export function isFatalSandboxError(error: unknown): error is SandboxError {
  return (
    error instanceof SandboxError && (error.code === "budgetExceeded" || error.code === "reentry")
  );
}

export type CompileOwner = {
  readonly budget: Budget;
  readonly generation: number;
};

export type CompileTicket = {
  readonly owner: CompileOwner;
};

class BudgetAccounting {
  readonly deadline?: number;
  readonly limits: Readonly<BudgetLimits>;
  stepsUsed = 0;
  peakCallDepth = 0;
  currentDataSize = 0;
  peakDataSize = 0;

  currentCallDepth = 0;
  allChecksSuspended = 0;
  deadlineChecksSuspended = 0;
  visitsUntilDeadlineCheck = DEADLINE_CHECK_INTERVAL;
  retainedDataSize = 0;
  readonly retainedData = new Map<object, number>();
  readonly retainedValueSources = new Map<object, () => Iterable<unknown> | undefined>();
  compileGeneration = 0;
  activeCompileOwner?: CompileOwner;
  defaultCompileOwner?: CompileOwner;
  compileUses = 0;
  provisionalScopes = 0;
  readonly compileTickets = new Map<CompileTicket, number>();
  readonly completedCompileTickets = new Set<CompileTicket>();

  realmViews?: Set<WeakRef<Budget>>;

  constructor(options: BudgetOptions = {}) {
    this.deadline = normalizeDeadline(options.deadline);
    this.limits = Object.freeze({
      maxSteps: normalizeLimit("maxSteps", options.maxSteps),
      maxCallDepth: normalizeLimit("maxCallDepth", options.maxCallDepth),
      stringLength: normalizeLimit("stringLength", options.stringLength),
      arrayLength: normalizeLimit("arrayLength", options.arrayLength),
      dataSize: normalizeLimit("dataSize", options.dataSize)
    });
  }
}

export class Budget {
  private accounting: BudgetAccounting;

  constructor(options: BudgetOptions = {}) {
    this.accounting = new BudgetAccounting(options);
  }

  get deadline(): number | undefined { return this.accounting.deadline; }
  get limits(): Readonly<BudgetLimits> { return this.accounting.limits; }
  get stepsUsed(): number { return this.accounting.stepsUsed; }
  set stepsUsed(value: number) { this.accounting.stepsUsed = value; }
  get peakCallDepth(): number { return this.accounting.peakCallDepth; }
  set peakCallDepth(value: number) { this.accounting.peakCallDepth = value; }
  get currentDataSize(): number { return this.accounting.currentDataSize; }
  set currentDataSize(value: number) { this.accounting.currentDataSize = value; }
  get peakDataSize(): number { return this.accounting.peakDataSize; }
  set peakDataSize(value: number) { this.accounting.peakDataSize = value; }
  get currentCallDepth(): number { return this.accounting.currentCallDepth; }
  set currentCallDepth(value: number) { this.accounting.currentCallDepth = value; }

  forkRealm(): Budget {
    // Realm-indexed caches use the view identity; all limits and usage stay shared.
    const view = new Budget();
    view.accounting = this.accounting;
    const views = this.accounting.realmViews ??= new Set([new WeakRef(this)]);
    views.add(new WeakRef(view));
    return view;
  }

  visitNode(units = 1): void {
    if (!Number.isSafeInteger(units) || units < 0) {
      throw new Error("units must be a non-negative safe integer.");
    }
    if (units === 0) return;

    this.accounting.stepsUsed += units;
    this.checkSampledDeadline(units);

    if (
      this.accounting.allChecksSuspended === 0 &&
      this.accounting.limits.maxSteps !== undefined &&
      this.accounting.stepsUsed > this.accounting.limits.maxSteps
    ) {
      throw new SandboxError({
        budget: "steps",
        current: this.accounting.stepsUsed,
        limit: this.accounting.limits.maxSteps
      });
    }
  }

  allocateString(value: string): string {
    if (
      this.accounting.allChecksSuspended === 0 &&
      this.accounting.limits.stringLength !== undefined &&
      value.length > this.accounting.limits.stringLength
    ) {
      throw new SandboxError({
        budget: "stringLength",
        current: value.length,
        limit: this.accounting.limits.stringLength
      });
    }

    return value;
  }

  allocateArrayLength(length: number): void {
    if (
      this.accounting.allChecksSuspended === 0 &&
      this.accounting.limits.arrayLength !== undefined &&
      length > this.accounting.limits.arrayLength
    ) {
      throw new SandboxError({
        budget: "arrayLength",
        current: length,
        limit: this.accounting.limits.arrayLength
      });
    }
  }

  allocateCollectionEntries(count: number): void {
    this.allocateArrayLength(count);
  }

  reconcileDataUsage(usage: number): void {
    const total = usage + this.accounting.retainedDataSize;
    this.checkDataUsage(total);
    this.accounting.currentDataSize = total;
    this.accounting.peakDataSize = Math.max(this.accounting.peakDataSize, total);
  }

  setRetainedDataUsage(owner: object, usage: number): void {
    if (!Number.isSafeInteger(usage) || usage < 0) {
      throw new TypeError("Retained data usage must be a non-negative safe integer.");
    }
    const delta = usage - (this.accounting.retainedData.get(owner) ?? 0);
    const total = this.accounting.currentDataSize + delta;
    this.checkDataUsage(total);
    if (usage === 0) this.accounting.retainedData.delete(owner);
    else this.accounting.retainedData.set(owner, usage);
    this.accounting.retainedDataSize += delta;
    this.accounting.currentDataSize = total;
    this.accounting.peakDataSize = Math.max(this.accounting.peakDataSize, total);
  }

  setRetainedValues(owner: object, values: (() => Iterable<unknown> | undefined) | undefined): void {
    if (values === undefined) this.accounting.retainedValueSources.delete(owner);
    else this.accounting.retainedValueSources.set(owner, values);
  }

  *retainedValues(): Iterable<unknown> {
    for (const values of this.accounting.retainedValueSources.values()) {
      const retained = values();
      if (retained !== undefined) yield* retained;
    }
  }

  acquireCompileOwner(
    reset = false,
    owner?: CompileOwner
  ): {
    owner: CompileOwner;
    release: () => void;
  } {
    if (
      (owner !== undefined &&
        (owner.budget.accounting !== this.accounting || owner.generation !== this.accounting.compileGeneration)) ||
      (this.accounting.activeCompileOwner !== undefined && this.accounting.activeCompileOwner !== owner) ||
      (reset && (this.accounting.compileUses !== 0 || owner !== undefined))
    ) {
      throw new SandboxError("reentry");
    }
    if (reset) this.reset();
    const selected = owner ?? (this.accounting.defaultCompileOwner ??= Object.freeze({ budget: this, generation: this.accounting.compileGeneration }));
    this.accounting.activeCompileOwner = selected;
    this.accounting.compileUses += 1;
    let released = false;
    return {
      owner: selected,
      release: () => {
        if (released) return;
        released = true;
        this.accounting.compileUses -= 1;
        if (this.accounting.compileUses === 0) this.accounting.activeCompileOwner = undefined;
      }
    };
  }

  createCompileTicket(owner: CompileOwner): CompileTicket {
    if (
      owner.budget.accounting !== this.accounting ||
      owner.generation !== this.accounting.compileGeneration ||
      this.accounting.activeCompileOwner !== owner
    ) {
      throw new SandboxError("reentry");
    }
    const ticket = Object.freeze({ owner });
    this.accounting.compileTickets.set(ticket, 0);
    return ticket;
  }

  compileTicketUsage(ticket: CompileTicket): number {
    return ticket.owner.generation === this.accounting.compileGeneration
      ? (this.accounting.compileTickets.get(ticket) ?? 0)
      : 0;
  }

  resizeCompileTicket(ticket: CompileTicket, usage: number): void {
    if (ticket.owner.generation !== this.accounting.compileGeneration || !this.accounting.compileTickets.has(ticket)) {
      throw new SandboxError("reentry");
    }
    this.setRetainedDataUsage(ticket, usage);
    this.accounting.compileTickets.set(ticket, usage);
  }

  discardCompileTicket(ticket: CompileTicket): void {
    if (ticket.owner.generation !== this.accounting.compileGeneration) return;
    const usage = this.accounting.compileTickets.get(ticket);
    if (usage === undefined) return;
    this.accounting.compileTickets.delete(ticket);
    this.accounting.completedCompileTickets.delete(ticket);
    this.accounting.retainedData.delete(ticket);
    this.accounting.retainedDataSize -= usage;
    this.accounting.currentDataSize -= usage;
  }

  reconcileCompileData(
    usage: number,
    included: ReadonlySet<CompileTicket>,
    transferred: ReadonlySet<CompileTicket> = included,
    retainedOwner?: object,
    complete = false
  ): ReadonlySet<CompileTicket> {
    let includedUsage = 0;
    let transferredUsage = 0;
    let discardedUsage = 0;
    const releasing: CompileTicket[] = [];
    const retained = new Set<CompileTicket>();
    for (const ticket of included) {
      const charge = this.compileTicketUsage(ticket);
      includedUsage += charge;
      if (
        charge > 0 &&
        transferred.has(ticket) &&
        (this.accounting.provisionalScopes === 0 || retainedOwner !== undefined)
      ) {
        releasing.push(ticket);
        transferredUsage += charge;
      } else if (charge > 0 && complete && transferred.has(ticket)) {
        retained.add(ticket);
      }
    }
    if (retainedOwner === undefined) {
      for (const ticket of this.accounting.completedCompileTickets) {
        if (included.has(ticket)) continue;
        releasing.push(ticket);
        discardedUsage += this.compileTicketUsage(ticket);
      }
    }
    const oldOwnerUsage =
      retainedOwner === undefined ? 0 : (this.accounting.retainedData.get(retainedOwner) ?? 0);
    const nextRetained =
      this.accounting.retainedDataSize -
      transferredUsage -
      discardedUsage +
      (retainedOwner === undefined ? 0 : usage - oldOwnerUsage);
    const measured =
      retainedOwner === undefined
        ? usage - includedUsage + transferredUsage
        : this.accounting.currentDataSize - this.accounting.retainedDataSize;
    const total = measured + nextRetained;
    this.checkDataUsage(total);
    for (const ticket of releasing) {
      this.accounting.compileTickets.delete(ticket);
      this.accounting.completedCompileTickets.delete(ticket);
      this.accounting.retainedData.delete(ticket);
    }
    if (retainedOwner !== undefined) {
      if (usage === 0) this.accounting.retainedData.delete(retainedOwner);
      else this.accounting.retainedData.set(retainedOwner, usage);
    }
    this.accounting.retainedDataSize = nextRetained;
    this.accounting.currentDataSize = total;
    this.accounting.peakDataSize = Math.max(this.accounting.peakDataSize, total);
    for (const ticket of retained) this.accounting.completedCompileTickets.add(ticket);
    return retained;
  }

  chargeDataUsage(usage: number): void {
    const total = this.accounting.currentDataSize + usage;
    this.checkDataUsage(total);
    this.accounting.currentDataSize = total;
    this.accounting.peakDataSize = Math.max(this.accounting.peakDataSize, total);
  }

  provisionDataUsage(usage: number): () => void {
    const previous = this.accounting.currentDataSize;
    const previousRetained = this.accounting.retainedDataSize;
    const next = previous + usage;
    this.checkDataUsage(next);
    this.accounting.currentDataSize = next;
    this.accounting.peakDataSize = Math.max(this.accounting.peakDataSize, next);
    const generation = this.accounting.compileGeneration;
    this.accounting.provisionalScopes += 1;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (generation !== this.accounting.compileGeneration) return;
      this.accounting.provisionalScopes -= 1;
      this.accounting.currentDataSize = previous + this.accounting.retainedDataSize - previousRetained;
    };
  }

  enterCall(): () => void {
    return this.enterDepth();
  }

  enterAwait(): () => void {
    return this.enterDepth();
  }

  reset(): void {
    if (this.accounting.compileUses !== 0) throw new SandboxError("reentry");
    releaseTemplateObjects(this);
    for (const reference of this.accounting.realmViews ?? []) {
      const view = reference.deref();
      if (view === undefined) this.accounting.realmViews!.delete(reference);
      else if (view !== this) releaseTemplateObjects(view);
    }
    this.accounting.compileGeneration += 1;
    this.accounting.defaultCompileOwner = undefined;
    this.accounting.provisionalScopes = 0;
    this.accounting.compileTickets.clear();
    this.accounting.completedCompileTickets.clear();
    this.accounting.stepsUsed = 0;
    this.accounting.peakCallDepth = 0;
    this.accounting.currentCallDepth = 0;
    this.accounting.currentDataSize = 0;
    this.accounting.peakDataSize = 0;
    this.accounting.retainedDataSize = 0;
    this.accounting.retainedData.clear();
    this.accounting.retainedValueSources.clear();
    this.accounting.allChecksSuspended = 0;
    this.accounting.deadlineChecksSuspended = 0;
    this.accounting.visitsUntilDeadlineCheck = DEADLINE_CHECK_INTERVAL;
  }

  suspendChecks(): () => void {
    this.accounting.allChecksSuspended += 1;

    let resumed = false;
    return () => {
      if (resumed) {
        return;
      }

      resumed = true;
      this.accounting.allChecksSuspended -= 1;
    };
  }

  suspendDeadlineChecks(): () => void {
    this.accounting.deadlineChecksSuspended += 1;

    let resumed = false;
    return () => {
      if (resumed) {
        return;
      }

      resumed = true;
      this.accounting.deadlineChecksSuspended -= 1;
    };
  }

  private checkDeadline(): void {
    if (
      this.accounting.allChecksSuspended > 0 ||
      this.accounting.deadlineChecksSuspended > 0 ||
      this.accounting.deadline === undefined
    ) {
      return;
    }

    const now = Date.now();
    if (now <= this.accounting.deadline) {
      return;
    }

    throw new SandboxError({
      budget: "deadline",
      current: now,
      limit: this.accounting.deadline
    });
  }

  private checkDataUsage(usage: number): void {
    if (
      this.accounting.allChecksSuspended === 0 &&
      this.accounting.limits.dataSize !== undefined &&
      usage > this.accounting.limits.dataSize
    ) {
      throw new SandboxError({
        budget: "dataSize",
        current: usage,
        limit: this.accounting.limits.dataSize
      });
    }
  }

  private checkSampledDeadline(units: number): void {
    if (
      this.accounting.allChecksSuspended > 0 ||
      this.accounting.deadlineChecksSuspended > 0 ||
      this.accounting.deadline === undefined
    ) {
      return;
    }

    this.accounting.visitsUntilDeadlineCheck -= units;
    if (this.accounting.visitsUntilDeadlineCheck > 0) {
      return;
    }

    this.accounting.visitsUntilDeadlineCheck =
      DEADLINE_CHECK_INTERVAL - (-this.accounting.visitsUntilDeadlineCheck % DEADLINE_CHECK_INTERVAL);
    this.checkDeadline();
  }

  private enterDepth(): () => void {
    const nextDepth = this.accounting.currentCallDepth + 1;

    if (
      this.accounting.allChecksSuspended === 0 &&
      this.accounting.limits.maxCallDepth !== undefined &&
      nextDepth > this.accounting.limits.maxCallDepth
    ) {
      throw new SandboxError({
        budget: "callDepth",
        current: nextDepth,
        limit: this.accounting.limits.maxCallDepth
      });
    }

    this.accounting.currentCallDepth = nextDepth;
    if (nextDepth > this.accounting.peakCallDepth) {
      this.accounting.peakCallDepth = nextDepth;
    }

    let left = false;
    return () => {
      if (left) {
        return;
      }

      left = true;
      this.accounting.currentCallDepth -= 1;
    };
  }
}

export function allocateRegexSteps(steps: number): void {
  if (!Number.isInteger(steps) || steps < 0) {
    throw new Error("steps must be a non-negative integer.");
  }
  if (steps > REGEX_STEP_LIMIT) {
    throw new SandboxError({ budget: "steps", current: steps, limit: REGEX_STEP_LIMIT });
  }
}

function normalizeDeadline(deadline: BudgetOptions["deadline"]): number | undefined {
  if (deadline === undefined) {
    return undefined;
  }

  return deadline instanceof Date ? deadline.getTime() : deadline;
}

function normalizeLimit(name: keyof BudgetLimits, value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }

  return value;
}
