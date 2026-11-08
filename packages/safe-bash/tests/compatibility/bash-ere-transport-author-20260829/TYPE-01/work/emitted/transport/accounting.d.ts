import type { EreExpansionBounds, EreLimits, EreUsage } from "../types.js";
export declare function integer(value: unknown): asserts value is number;
export declare function add(left: number, right: number): number;
export declare function multiply(value: number, factor: number): number;
export declare class EngineAccounting {
    #private;
    readonly limits: EreLimits;
    constructor(bounds: EreExpansionBounds);
    get usage(): EreUsage;
    reserve(patternBytes: number, subjectBytes: number): EreLimits;
    commit(allowance: EreLimits, usage: EreUsage): void;
    abandon(allowance: EreLimits, sent: boolean): void;
}
export declare class StorageReservation {
    #private;
    readonly ledger: TransportAccounting;
    constructor(ledger: TransportAccounting, units: number);
    consume(units: number): void;
    settle(actual: number): void;
    unknown(): void;
    releaseUnused(): void;
    retire(): void;
}
export declare class TransportAccounting {
    #private;
    readonly storageLimit: number;
    readonly workLimit: number;
    constructor(limits: EreLimits);
    get available(): number;
    get usage(): Readonly<{
        spent: number;
        reserved: number;
        live: number;
        work: number;
    }>;
    visit(units: number): void;
    metadata(fields: number): StorageReservation;
    reserve(units: number): StorageReservation;
    spend(units: number): void;
    unreserve(units: number): void;
    retire(units: number): void;
}
