import { replaceErrorStack } from "../error/shape.js";

export type BudgetName =
  | "steps"
  | "deadline"
  | "callDepth"
  | "stringLength"
  | "arrayLength"
  | "dataSize";

export type BudgetOptions = {
  maxSteps?: number;
  deadline?: number | Date;
  maxCallDepth?: number;
  stringLength?: number;
  arrayLength?: number;
  dataSize?: number;
};

export const REGEX_STEP_LIMIT = 2_000;
const DEADLINE_CHECK_INTERVAL = 1_024;

export class SandboxError extends Error {
  readonly code: "aborted" | "budgetExceeded";
  readonly budget?: BudgetName;
  readonly current?: number;
  readonly limit?: number;

  constructor(input: "aborted");
  constructor(input: { budget: BudgetName; current: number; limit: number });
  constructor(input: "aborted" | { budget: BudgetName; current: number; limit: number }) {
    super(
      input === "aborted"
        ? "aborted"
        : `Sandbox budget exceeded for ${input.budget}: ${input.current} > ${input.limit}.`
    );
    this.name = "SandboxError";
    replaceErrorStack(this);

    if (input === "aborted") {
      this.code = "aborted";
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

  visitNode(): void {
    this.stepsUsed += 1;
    this.checkSampledDeadline();

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
    this.checkDataUsage(usage);
    this.currentDataSize = usage;
    this.peakDataSize = Math.max(this.peakDataSize, usage);
  }

  provisionDataUsage(usage: number): () => void {
    const previous = this.currentDataSize;
    const next = previous + usage;
    this.checkDataUsage(next);
    this.currentDataSize = next;
    this.peakDataSize = Math.max(this.peakDataSize, next);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.currentDataSize = previous;
    };
  }

  enterCall(): () => void {
    return this.enterDepth();
  }

  enterAwait(): () => void {
    return this.enterDepth();
  }

  reset(): void {
    this.stepsUsed = 0;
    this.peakCallDepth = 0;
    this.currentCallDepth = 0;
    this.currentDataSize = 0;
    this.peakDataSize = 0;
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

  private checkSampledDeadline(): void {
    if (
      this.allChecksSuspended > 0 ||
      this.deadlineChecksSuspended > 0 ||
      this.deadline === undefined
    ) {
      return;
    }

    this.visitsUntilDeadlineCheck -= 1;
    if (this.visitsUntilDeadlineCheck > 0) {
      return;
    }

    this.visitsUntilDeadlineCheck = DEADLINE_CHECK_INTERVAL;
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
