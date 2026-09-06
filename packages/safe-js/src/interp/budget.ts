import { replaceErrorStack } from "../error/shape.js";
import { releaseTemplateObjects } from "./template-objects.js";

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

export class Budget {
  readonly deadline?: number;
  readonly limits: Readonly<BudgetLimits>;
  stepsUsed = 0;
  peakCallDepth = 0;
  currentDataSize = 0;
  peakDataSize = 0;

  currentCallDepth = 0;
  private allChecksSuspended = 0;
  private deadlineChecksSuspended = 0;
  private visitsUntilDeadlineCheck = DEADLINE_CHECK_INTERVAL;
  private retainedDataSize = 0;
  private readonly retainedData = new Map<object, number>();
  private readonly retainedValueSources = new Map<object, () => Iterable<unknown>>();
  private compileGeneration = 0;
  private activeCompileOwner?: CompileOwner;
  private defaultCompileOwner?: CompileOwner;
  private compileUses = 0;
  private provisionalScopes = 0;
  private readonly compileTickets = new Map<CompileTicket, number>();
  private readonly completedCompileTickets = new Set<CompileTicket>();

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

  visitNode(units = 1): void {
    if (!Number.isSafeInteger(units) || units < 0) {
      throw new Error("units must be a non-negative safe integer.");
    }
    if (units === 0) return;

    this.stepsUsed += units;
    this.checkSampledDeadline(units);

    if (
      this.allChecksSuspended === 0 &&
      this.limits.maxSteps !== undefined &&
      this.stepsUsed > this.limits.maxSteps
    ) {
      throw new SandboxError({
        budget: "steps",
        current: this.stepsUsed,
        limit: this.limits.maxSteps
      });
    }
  }

  allocateString(value: string): string {
    if (
      this.allChecksSuspended === 0 &&
      this.limits.stringLength !== undefined &&
      value.length > this.limits.stringLength
    ) {
      throw new SandboxError({
        budget: "stringLength",
        current: value.length,
        limit: this.limits.stringLength
      });
    }

    return value;
  }

  allocateArrayLength(length: number): void {
    if (
      this.allChecksSuspended === 0 &&
      this.limits.arrayLength !== undefined &&
      length > this.limits.arrayLength
    ) {
      throw new SandboxError({
        budget: "arrayLength",
        current: length,
        limit: this.limits.arrayLength
      });
    }
  }

  allocateCollectionEntries(count: number): void {
    this.allocateArrayLength(count);
  }

  reconcileDataUsage(usage: number): void {
    const total = usage + this.retainedDataSize;
    this.checkDataUsage(total);
    this.currentDataSize = total;
    this.peakDataSize = Math.max(this.peakDataSize, total);
  }

  setRetainedDataUsage(owner: object, usage: number): void {
    if (!Number.isSafeInteger(usage) || usage < 0) {
      throw new TypeError("Retained data usage must be a non-negative safe integer.");
    }
    const delta = usage - (this.retainedData.get(owner) ?? 0);
    const total = this.currentDataSize + delta;
    this.checkDataUsage(total);
    if (usage === 0) this.retainedData.delete(owner);
    else this.retainedData.set(owner, usage);
    this.retainedDataSize += delta;
    this.currentDataSize = total;
    this.peakDataSize = Math.max(this.peakDataSize, total);
  }

  setRetainedValues(owner: object, values: (() => Iterable<unknown>) | undefined): void {
    if (values === undefined) this.retainedValueSources.delete(owner);
    else this.retainedValueSources.set(owner, values);
  }

  *retainedValues(): Iterable<unknown> {
    for (const values of this.retainedValueSources.values()) yield* values();
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
        (owner.budget !== this || owner.generation !== this.compileGeneration)) ||
      (this.activeCompileOwner !== undefined && this.activeCompileOwner !== owner) ||
      (reset && (this.compileUses !== 0 || owner !== undefined))
    ) {
      throw new SandboxError("reentry");
    }
    if (reset) this.reset();
    const selected = owner ?? (this.defaultCompileOwner ??= Object.freeze({ budget: this, generation: this.compileGeneration }));
    this.activeCompileOwner = selected;
    this.compileUses += 1;
    let released = false;
    return {
      owner: selected,
      release: () => {
        if (released) return;
        released = true;
        this.compileUses -= 1;
        if (this.compileUses === 0) this.activeCompileOwner = undefined;
      }
    };
  }

  createCompileTicket(owner: CompileOwner): CompileTicket {
    if (
      owner.budget !== this ||
      owner.generation !== this.compileGeneration ||
      this.activeCompileOwner !== owner
    ) {
      throw new SandboxError("reentry");
    }
    const ticket = Object.freeze({ owner });
    this.compileTickets.set(ticket, 0);
    return ticket;
  }

  compileTicketUsage(ticket: CompileTicket): number {
    return ticket.owner.generation === this.compileGeneration
      ? (this.compileTickets.get(ticket) ?? 0)
      : 0;
  }

  resizeCompileTicket(ticket: CompileTicket, usage: number): void {
    if (ticket.owner.generation !== this.compileGeneration || !this.compileTickets.has(ticket)) {
      throw new SandboxError("reentry");
    }
    this.setRetainedDataUsage(ticket, usage);
    this.compileTickets.set(ticket, usage);
  }

  discardCompileTicket(ticket: CompileTicket): void {
    if (ticket.owner.generation !== this.compileGeneration) return;
    const usage = this.compileTickets.get(ticket);
    if (usage === undefined) return;
    this.compileTickets.delete(ticket);
    this.completedCompileTickets.delete(ticket);
    this.retainedData.delete(ticket);
    this.retainedDataSize -= usage;
    this.currentDataSize -= usage;
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
        (this.provisionalScopes === 0 || retainedOwner !== undefined)
      ) {
        releasing.push(ticket);
        transferredUsage += charge;
      } else if (charge > 0 && complete && transferred.has(ticket)) {
        retained.add(ticket);
      }
    }
    if (retainedOwner === undefined) {
      for (const ticket of this.completedCompileTickets) {
        if (included.has(ticket)) continue;
        releasing.push(ticket);
        discardedUsage += this.compileTicketUsage(ticket);
      }
    }
    const oldOwnerUsage =
      retainedOwner === undefined ? 0 : (this.retainedData.get(retainedOwner) ?? 0);
    const nextRetained =
      this.retainedDataSize -
      transferredUsage -
      discardedUsage +
      (retainedOwner === undefined ? 0 : usage - oldOwnerUsage);
    const measured =
      retainedOwner === undefined
        ? usage - includedUsage + transferredUsage
        : this.currentDataSize - this.retainedDataSize;
    const total = measured + nextRetained;
    this.checkDataUsage(total);
    for (const ticket of releasing) {
      this.compileTickets.delete(ticket);
      this.completedCompileTickets.delete(ticket);
      this.retainedData.delete(ticket);
    }
    if (retainedOwner !== undefined) {
      if (usage === 0) this.retainedData.delete(retainedOwner);
      else this.retainedData.set(retainedOwner, usage);
    }
    this.retainedDataSize = nextRetained;
    this.currentDataSize = total;
    this.peakDataSize = Math.max(this.peakDataSize, total);
    for (const ticket of retained) this.completedCompileTickets.add(ticket);
    return retained;
  }

  chargeDataUsage(usage: number): void {
    const total = this.currentDataSize + usage;
    this.checkDataUsage(total);
    this.currentDataSize = total;
    this.peakDataSize = Math.max(this.peakDataSize, total);
  }

  provisionDataUsage(usage: number): () => void {
    const previous = this.currentDataSize;
    const previousRetained = this.retainedDataSize;
    const next = previous + usage;
    this.checkDataUsage(next);
    this.currentDataSize = next;
    this.peakDataSize = Math.max(this.peakDataSize, next);
    const generation = this.compileGeneration;
    this.provisionalScopes += 1;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (generation !== this.compileGeneration) return;
      this.provisionalScopes -= 1;
      this.currentDataSize = previous + this.retainedDataSize - previousRetained;
    };
  }

  enterCall(): () => void {
    return this.enterDepth();
  }

  enterAwait(): () => void {
    return this.enterDepth();
  }

  reset(): void {
    if (this.compileUses !== 0) throw new SandboxError("reentry");
    releaseTemplateObjects(this);
    this.compileGeneration += 1;
    this.defaultCompileOwner = undefined;
    this.provisionalScopes = 0;
    this.compileTickets.clear();
    this.completedCompileTickets.clear();
    this.stepsUsed = 0;
    this.peakCallDepth = 0;
    this.currentCallDepth = 0;
    this.currentDataSize = 0;
    this.peakDataSize = 0;
    this.retainedDataSize = 0;
    this.retainedData.clear();
    this.retainedValueSources.clear();
    this.allChecksSuspended = 0;
    this.deadlineChecksSuspended = 0;
    this.visitsUntilDeadlineCheck = DEADLINE_CHECK_INTERVAL;
  }

  suspendChecks(): () => void {
    this.allChecksSuspended += 1;

    let resumed = false;
    return () => {
      if (resumed) {
        return;
      }

      resumed = true;
      this.allChecksSuspended -= 1;
    };
  }

  suspendDeadlineChecks(): () => void {
    this.deadlineChecksSuspended += 1;

    let resumed = false;
    return () => {
      if (resumed) {
        return;
      }

      resumed = true;
      this.deadlineChecksSuspended -= 1;
    };
  }

  private checkDeadline(): void {
    if (
      this.allChecksSuspended > 0 ||
      this.deadlineChecksSuspended > 0 ||
      this.deadline === undefined
    ) {
      return;
    }

    const now = Date.now();
    if (now <= this.deadline) {
      return;
    }

    throw new SandboxError({
      budget: "deadline",
      current: now,
      limit: this.deadline
    });
  }

  private checkDataUsage(usage: number): void {
    if (
      this.allChecksSuspended === 0 &&
      this.limits.dataSize !== undefined &&
      usage > this.limits.dataSize
    ) {
      throw new SandboxError({
        budget: "dataSize",
        current: usage,
        limit: this.limits.dataSize
      });
    }
  }

  private checkSampledDeadline(units: number): void {
    if (
      this.allChecksSuspended > 0 ||
      this.deadlineChecksSuspended > 0 ||
      this.deadline === undefined
    ) {
      return;
    }

    this.visitsUntilDeadlineCheck -= units;
    if (this.visitsUntilDeadlineCheck > 0) {
      return;
    }

    this.visitsUntilDeadlineCheck =
      DEADLINE_CHECK_INTERVAL - (-this.visitsUntilDeadlineCheck % DEADLINE_CHECK_INTERVAL);
    this.checkDeadline();
  }

  private enterDepth(): () => void {
    const nextDepth = this.currentCallDepth + 1;

    if (
      this.allChecksSuspended === 0 &&
      this.limits.maxCallDepth !== undefined &&
      nextDepth > this.limits.maxCallDepth
    ) {
      throw new SandboxError({
        budget: "callDepth",
        current: nextDepth,
        limit: this.limits.maxCallDepth
      });
    }

    this.currentCallDepth = nextDepth;
    if (nextDepth > this.peakCallDepth) {
      this.peakCallDepth = nextDepth;
    }

    let left = false;
    return () => {
      if (left) {
        return;
      }

      left = true;
      this.currentCallDepth -= 1;
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
