import { setImmediate } from "node:timers/promises";
import { EreProfileLimitError, EreUsageUnknownError } from "./errors.js";
const resources = Object.freeze([
    "patternBytes", "subjectBytes", "work", "states", "allocationUnits", "captureBytes", "captureSlots",
]);
function integer(value) {
    if (!Number.isSafeInteger(value) || value < 0)
        throw new TypeError("ERE bounds must be nonnegative safe integers");
}
function multiply(value, factor, ceiling) {
    return value > Math.floor(ceiling / factor) ? ceiling : value * factor;
}
export function deriveEreLimits(bounds) {
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
    limits;
    #usage = {
        patternBytes: 0, subjectBytes: 0, work: 0, states: 0, allocationUnits: 0, captureBytes: 0, captureSlots: 0,
    };
    #poison;
    #lastYield = 0;
    constructor(bounds, lowering = {}) {
        const limits = { ...deriveEreLimits(bounds) };
        for (const resource of Object.keys(lowering)) {
            if (!resources.includes(resource))
                throw new TypeError("unknown ERE limit");
            const key = resource;
            const value = lowering[key];
            if (value === undefined)
                throw new TypeError("undefined ERE limit");
            integer(value);
            if (value > limits[key])
                throw new RangeError("ERE limits may only be lowered");
            limits[key] = value;
        }
        this.limits = Object.freeze(limits);
    }
    get usage() { return Object.freeze({ ...this.#usage }); }
    check(signal) {
        if (signal?.aborted)
            throw signal.reason;
        if (this.#poison)
            throw this.#poison;
    }
    charge(resource, amount, signal) {
        this.check(signal);
        integer(amount);
        if (amount > this.limits[resource] - this.#usage[resource]) {
            throw new EreProfileLimitError(resource, this.limits[resource]);
        }
        this.#usage[resource] += amount;
    }
    admitInput(resource, length, signal) {
        this.check(signal);
        integer(length);
        if (length > this.limits[resource])
            throw new EreProfileLimitError(resource, this.limits[resource]);
        this.#usage[resource] = Math.max(this.#usage[resource], length);
    }
    async checkpoint(signal) {
        this.check(signal);
        if (this.#usage.work - this.#lastYield >= 256) {
            this.#lastYield = this.#usage.work;
            await setImmediate();
            this.check(signal);
        }
    }
    markUnknownUsage(reason) {
        this.#poison ??= new EreUsageUnknownError(reason);
    }
}
