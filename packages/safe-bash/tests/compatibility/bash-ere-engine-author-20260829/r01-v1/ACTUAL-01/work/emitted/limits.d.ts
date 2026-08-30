import type { EreExpansionBounds, EreLimits, EreResource, EreUsage } from "./types.js";
export declare function deriveEreLimits(bounds: EreExpansionBounds): EreLimits;
export declare class EreLedger {
    #private;
    readonly limits: EreLimits;
    constructor(bounds: EreExpansionBounds, lowering?: Partial<EreLimits>);
    get usage(): EreUsage;
    check(signal?: AbortSignal): void;
    charge(resource: EreResource, amount: number, signal?: AbortSignal): void;
    admitInput(resource: "patternBytes" | "subjectBytes", length: number, signal?: AbortSignal): void;
    checkpoint(signal?: AbortSignal): Promise<void>;
    markUnknownUsage(reason: unknown): void;
}
