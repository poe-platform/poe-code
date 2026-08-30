import type { EreExpansionBounds, EreFragment, EreLimits, EreResource, EreSpan, EreUsage } from "../types.js";
export declare const operation = "shell-ere";
export declare const profile = "ascii-c-posix-v1";
export declare const resources: readonly EreResource[];
export declare const cumulative: readonly EreResource[];
export interface EreTransportResult {
    readonly matched: boolean;
    readonly groupCount: number;
    readonly spans: readonly (EreSpan | null)[];
    readonly steps: number;
    readonly allocatedUnits: number;
}
export interface EreTransportRequest {
    readonly version: 1;
    readonly operation: typeof operation;
    readonly id: number;
    readonly grantId: number;
    readonly profile: typeof profile;
    readonly bounds: EreExpansionBounds;
    readonly allowance: EreLimits;
    readonly pattern: readonly EreFragment[];
    readonly subject: string;
}
export type EreTransportReply = {
    readonly version: 1;
    readonly operation: typeof operation;
    readonly id: number;
    readonly grantId: number;
    readonly kind: "result";
    readonly result: EreTransportResult;
    readonly usage: EreUsage;
} | {
    readonly version: 1;
    readonly operation: typeof operation;
    readonly id: number;
    readonly grantId: number;
    readonly kind: "failure";
    readonly category: "syntax" | "unsupported" | "profile-limit";
    readonly resource: EreResource | null;
    readonly offset: number | null;
    readonly usage: EreUsage;
};
export interface EreTransportInput {
    readonly pattern: readonly EreFragment[];
    readonly subject: string;
}
export interface EreTransportSession {
    execute(input: EreTransportInput, signal?: AbortSignal): Promise<EreTransportResult>;
    close(): Promise<void>;
}
export type EreCleanupRegistration = (cleanup: () => Promise<void>) => void;
export declare class EreTransportError extends Error {
    readonly code: "PROTOCOL" | "CLOSED" | "STARTUP_TIMEOUT" | "REQUEST_TIMEOUT" | "WORKER_EXIT";
    constructor(code: "PROTOCOL" | "CLOSED" | "STARTUP_TIMEOUT" | "REQUEST_TIMEOUT" | "WORKER_EXIT", message: string);
}
export declare class EreTransportProfileLimitError extends Error {
    readonly resource: "transportStorage" | "transportWork" | "queueTickets";
    readonly limit: number;
    readonly status = 3;
    constructor(resource: "transportStorage" | "transportWork" | "queueTickets", limit: number);
}
export declare class EreTransportSemanticError extends Error {
    readonly category: "syntax" | "unsupported";
    readonly offset: number | null;
    readonly status = 2;
    constructor(category: "syntax" | "unsupported", offset: number | null);
}
