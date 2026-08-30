import { replaceErrorStack } from "../error/shape.js";
export const REGEX_STEP_LIMIT = 2_000;
const DEADLINE_CHECK_INTERVAL = 1_024;
export class SandboxError extends Error {
    code;
    budget;
    current;
    limit;
    constructor(input) {
        super(input === "aborted"
            ? "aborted"
            : input === "reentry"
                ? "Sandbox object is already running."
                : `Sandbox budget exceeded for ${input.budget}: ${input.current} > ${input.limit}.`);
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
export class Budget {
    deadline;
    limits;
    stepsUsed = 0;
    peakCallDepth = 0;
    currentDataSize = 0;
    peakDataSize = 0;
    currentCallDepth = 0;
    allChecksSuspended = 0;
    deadlineChecksSuspended = 0;
    visitsUntilDeadlineCheck = DEADLINE_CHECK_INTERVAL;
    retainedDataSize = 0;
    retainedData = new Map();
    retainedValueSources = new Map();
    constructor(options = {}) {
        this.deadline = normalizeDeadline(options.deadline);
        this.limits = Object.freeze({
            maxSteps: normalizeLimit("maxSteps", options.maxSteps),
            maxCallDepth: normalizeLimit("maxCallDepth", options.maxCallDepth),
            stringLength: normalizeLimit("stringLength", options.stringLength),
            arrayLength: normalizeLimit("arrayLength", options.arrayLength),
            dataSize: normalizeLimit("dataSize", options.dataSize)
        });
    }
    visitNode() {
        this.stepsUsed += 1;
        this.checkSampledDeadline();
        if (this.allChecksSuspended === 0 &&
            this.limits.maxSteps !== undefined &&
            this.stepsUsed > this.limits.maxSteps) {
            throw new SandboxError({
                budget: "steps",
                current: this.stepsUsed,
                limit: this.limits.maxSteps
            });
        }
    }
    allocateString(value) {
        if (this.allChecksSuspended === 0 &&
            this.limits.stringLength !== undefined &&
            value.length > this.limits.stringLength) {
            throw new SandboxError({
                budget: "stringLength",
                current: value.length,
                limit: this.limits.stringLength
            });
        }
        return value;
    }
    allocateArrayLength(length) {
        if (this.allChecksSuspended === 0 &&
            this.limits.arrayLength !== undefined &&
            length > this.limits.arrayLength) {
            throw new SandboxError({
                budget: "arrayLength",
                current: length,
                limit: this.limits.arrayLength
            });
        }
    }
    allocateCollectionEntries(count) {
        this.allocateArrayLength(count);
    }
    reconcileDataUsage(usage) {
        const total = usage + this.retainedDataSize;
        this.checkDataUsage(total);
        this.currentDataSize = total;
        this.peakDataSize = Math.max(this.peakDataSize, total);
    }
    setRetainedDataUsage(owner, usage) {
        if (!Number.isSafeInteger(usage) || usage < 0) {
            throw new TypeError("Retained data usage must be a non-negative safe integer.");
        }
        const delta = usage - (this.retainedData.get(owner) ?? 0);
        const total = this.currentDataSize + delta;
        this.checkDataUsage(total);
        if (usage === 0)
            this.retainedData.delete(owner);
        else
            this.retainedData.set(owner, usage);
        this.retainedDataSize += delta;
        this.currentDataSize = total;
        this.peakDataSize = Math.max(this.peakDataSize, total);
    }
    setRetainedValues(owner, values) {
        if (values === undefined)
            this.retainedValueSources.delete(owner);
        else
            this.retainedValueSources.set(owner, values);
    }
    *retainedValues() {
        for (const values of this.retainedValueSources.values())
            yield* values();
    }
    provisionDataUsage(usage) {
        const previous = this.currentDataSize;
        const previousRetained = this.retainedDataSize;
        const next = previous + usage;
        this.checkDataUsage(next);
        this.currentDataSize = next;
        this.peakDataSize = Math.max(this.peakDataSize, next);
        let released = false;
        return () => {
            if (released)
                return;
            released = true;
            this.currentDataSize = previous + this.retainedDataSize - previousRetained;
        };
    }
    enterCall() {
        return this.enterDepth();
    }
    enterAwait() {
        return this.enterDepth();
    }
    reset() {
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
    suspendChecks() {
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
    suspendDeadlineChecks() {
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
    checkDeadline() {
        if (this.allChecksSuspended > 0 ||
            this.deadlineChecksSuspended > 0 ||
            this.deadline === undefined) {
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
    checkDataUsage(usage) {
        if (this.allChecksSuspended === 0 &&
            this.limits.dataSize !== undefined &&
            usage > this.limits.dataSize) {
            throw new SandboxError({
                budget: "dataSize",
                current: usage,
                limit: this.limits.dataSize
            });
        }
    }
    checkSampledDeadline() {
        if (this.allChecksSuspended > 0 ||
            this.deadlineChecksSuspended > 0 ||
            this.deadline === undefined) {
            return;
        }
        this.visitsUntilDeadlineCheck -= 1;
        if (this.visitsUntilDeadlineCheck > 0) {
            return;
        }
        this.visitsUntilDeadlineCheck = DEADLINE_CHECK_INTERVAL;
        this.checkDeadline();
    }
    enterDepth() {
        const nextDepth = this.currentCallDepth + 1;
        if (this.allChecksSuspended === 0 &&
            this.limits.maxCallDepth !== undefined &&
            nextDepth > this.limits.maxCallDepth) {
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
export function allocateRegexSteps(steps) {
    if (!Number.isInteger(steps) || steps < 0) {
        throw new Error("steps must be a non-negative integer.");
    }
    if (steps > REGEX_STEP_LIMIT) {
        throw new SandboxError({ budget: "steps", current: steps, limit: REGEX_STEP_LIMIT });
    }
}
function normalizeDeadline(deadline) {
    if (deadline === undefined) {
        return undefined;
    }
    return deadline instanceof Date ? deadline.getTime() : deadline;
}
function normalizeLimit(name, value) {
    if (value === undefined) {
        return undefined;
    }
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(`${name} must be a non-negative integer.`);
    }
    return value;
}
