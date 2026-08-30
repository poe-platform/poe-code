import type { EreResource } from "./types.js";
export declare class EreSyntaxError extends Error {
    readonly offset: number;
    readonly status = 2;
    constructor(message: string, offset: number);
}
export declare class EreUnsupportedError extends Error {
    readonly offset: number;
    readonly status = 2;
    constructor(message: string, offset: number);
}
export declare class EreProfileLimitError extends Error {
    readonly resource: EreResource;
    readonly limit: number;
    readonly status = 3;
    constructor(resource: EreResource, limit: number);
}
export declare class EreUsageUnknownError extends Error {
    readonly status = 3;
    constructor(reason: unknown);
}
