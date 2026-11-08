import type { EreLimits, EreUsage } from "../types.js";
import { TransportAccounting } from "./accounting.js";
import type { EreTransportInput, EreTransportReply, EreTransportRequest, EreTransportResult } from "./protocol.js";
export declare function record(value: unknown, keys: readonly string[], visit: (units: number) => void): Record<string, unknown>;
export declare function usage(value: unknown, allowance: EreLimits, visit: (units: number) => void): EreUsage;
export interface InspectedInput {
    readonly input: EreTransportInput;
    readonly patternBytes: number;
    readonly units: number;
}
export declare function inspectInput(value: EreTransportInput, limits: EreLimits, transport: TransportAccounting, signal?: AbortSignal): InspectedInput;
export declare function copyInput(inspected: InspectedInput, transport: TransportAccounting): EreTransportInput;
export declare function validateRequest(value: unknown): EreTransportRequest;
export declare function validateReply(value: unknown, request: EreTransportRequest, visit: (units: number) => void): {
    reply: EreTransportReply;
    replyUnits: number;
    resultUnits: number;
};
export declare function copyReplyResult(reply: Extract<EreTransportReply, {
    kind: "result";
}>): EreTransportResult;
