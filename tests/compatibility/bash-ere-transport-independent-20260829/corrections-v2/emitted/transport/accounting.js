import { deriveEreLimits } from "../limits.js";
import { cumulative, EreTransportError, EreTransportProfileLimitError, resources } from "./protocol.js";
export function integer(value) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0))
        throw new EreTransportError("PROTOCOL", "invalid finite transport integer");
}
export function add(left, right) {
    integer(left);
    integer(right);
    if (left > Number.MAX_SAFE_INTEGER - right)
        throw new EreTransportError("PROTOCOL", "transport arithmetic overflow");
    return left + right;
}
export function multiply(value, factor) {
    integer(value);
    integer(factor);
    if (factor !== 0 && value > Math.floor(Number.MAX_SAFE_INTEGER / factor))
        throw new EreTransportError("PROTOCOL", "transport arithmetic overflow");
    return value * factor;
}
export const workerReplyValidationWork = 210;
export function workerValidationPrepayment(requestUnits, fragments) {
    integer(requestUnits);
    if (requestUnits < 47)
        throw new EreTransportError("PROTOCOL", "invalid ERE request units");
    integer(fragments);
    return add(add(requestUnits, 205), fragments);
}
export const metadataUnits = Object.freeze({
    root: 18 + 5 + 7 + 3 + 8 + 8 + 2 + 10,
    session: 3 + 2,
    ticket: 16 + 1 + 4 + 3 + 2 + 4 + 4,
    worker: 21 + 15 + 4 + 28,
    usage: 3 + 8 + 5,
});
export function assertBootstrapStorage(bounds, units) {
    integer(bounds.maxExpansionBytes);
    integer(bounds.maxExpansionFields);
    integer(units);
    const byteUnits = bounds.maxExpansionBytes > 500_000 ? 4_000_000 : bounds.maxExpansionBytes * 8;
    const fieldUnits = bounds.maxExpansionFields > 31_250 ? 4_000_000 : bounds.maxExpansionFields * 128;
    const limit = Math.min(4_000_000, byteUnits + fieldUnits);
    if (add(units, 5) > limit)
        throw new EreTransportProfileLimitError("transportStorage", limit);
    const work = bounds.maxExpansionBytes > 1_562_500 ? 50_000_000 : bounds.maxExpansionBytes * 32;
    if (add(units, 5) > work)
        throw new EreTransportProfileLimitError("transportWork", work);
}
function zero() {
    return { patternBytes: 0, subjectBytes: 0, work: 0, states: 0, allocationUnits: 0, captureBytes: 0, captureSlots: 0 };
}
export class EngineAccounting {
    limits;
    #spent = zero();
    #active;
    #poisoned = false;
    constructor(bounds) { this.limits = deriveEreLimits(bounds); }
    get usage() { return Object.freeze({ ...this.#spent }); }
    reserve(patternBytes, subjectBytes) {
        if (this.#poisoned || this.#active)
            throw new EreTransportError("CLOSED", "engine grant unavailable");
        integer(patternBytes);
        integer(subjectBytes);
        if (patternBytes > this.limits.patternBytes || subjectBytes > this.limits.subjectBytes)
            throw new EreTransportError("PROTOCOL", "unadmitted engine input");
        const allowance = { ...this.limits };
        for (const resource of cumulative)
            allowance[resource] -= this.#spent[resource];
        this.#spent.patternBytes = Math.max(this.#spent.patternBytes, patternBytes);
        this.#spent.subjectBytes = Math.max(this.#spent.subjectBytes, subjectBytes);
        this.#active = Object.freeze(allowance);
        return this.#active;
    }
    commit(allowance, usage) {
        if (allowance !== this.#active)
            throw new EreTransportError("PROTOCOL", "grant already reconciled or foreign");
        for (const resource of resources) {
            integer(usage[resource]);
            if (usage[resource] > allowance[resource])
                throw new EreTransportError("PROTOCOL", "over-grant usage");
        }
        for (const resource of cumulative)
            this.#spent[resource] += usage[resource];
        this.#active = undefined;
    }
    abandon(allowance, sent) {
        if (allowance !== this.#active)
            throw new EreTransportError("PROTOCOL", "foreign abandoned grant");
        if (sent) {
            for (const resource of cumulative)
                this.#spent[resource] += allowance[resource];
            this.#poisoned = true;
        }
        this.#active = undefined;
    }
}
export class StorageReservation {
    ledger;
    #remaining;
    #live = 5;
    #released = false;
    constructor(ledger, units) {
        this.ledger = ledger;
        this.#remaining = units;
    }
    consume(units) {
        integer(units);
        if (this.#released || units > this.#remaining)
            throw new EreTransportError("PROTOCOL", "invalid transport reservation spend");
        this.#remaining -= units;
        this.#live += units;
        this.ledger.spend(units);
    }
    settle(actual) { this.consume(actual); this.releaseUnused(); }
    unknown() { this.consume(this.#remaining); this.releaseUnused(); }
    releaseUnused() {
        if (this.#released)
            return;
        this.#released = true;
        this.ledger.unreserve(this.#remaining);
        this.#remaining = 0;
    }
    retire() {
        this.ledger.retire(this.#live);
        this.#live = 0;
    }
}
export class TransportAccounting {
    storageLimit;
    workLimit;
    #spent = 0;
    #reserved = 0;
    #live = 0;
    #work = 0;
    constructor(limits) { this.storageLimit = limits.allocationUnits; this.workLimit = limits.work; }
    get available() { return this.storageLimit - this.#spent - this.#reserved; }
    get usage() { return Object.freeze({ spent: this.#spent, reserved: this.#reserved, live: this.#live, work: this.#work }); }
    visit(units) {
        integer(units);
        if (units > this.workLimit - this.#work)
            throw new EreTransportProfileLimitError("transportWork", this.workLimit);
        this.#work += units;
    }
    metadata(fields) { return this.owned(add(1, fields)); }
    owned(units) {
        this.visit(units);
        const reservation = this.reserve(units);
        reservation.consume(units);
        reservation.releaseUnused();
        return reservation;
    }
    reserve(units) {
        integer(units);
        const tokenUnits = 5;
        if (add(units, tokenUnits) > this.available)
            throw new EreTransportProfileLimitError("transportStorage", this.storageLimit);
        this.visit(tokenUnits);
        this.#spent += tokenUnits;
        this.#live += tokenUnits;
        this.#reserved += units;
        return new StorageReservation(this, units);
    }
    spend(units) {
        if (units > this.#reserved)
            throw new EreTransportError("PROTOCOL", "transport reservation underflow");
        this.#reserved -= units;
        this.#spent += units;
        this.#live += units;
    }
    unreserve(units) { if (units > this.#reserved)
        throw new EreTransportError("PROTOCOL", "transport reservation underflow"); this.#reserved -= units; }
    retire(units) { if (units > this.#live)
        throw new EreTransportError("PROTOCOL", "transport ownership underflow"); this.#live -= units; }
}
