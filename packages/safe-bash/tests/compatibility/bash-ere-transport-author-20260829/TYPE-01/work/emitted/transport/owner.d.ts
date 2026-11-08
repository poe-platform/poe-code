import type { EreTransportRequest } from "./protocol.js";
export declare class EreWorkerOwner {
    #private;
    readonly onFailure: (reason: unknown) => void;
    readonly visit: (units: number) => void;
    constructor(onFailure: (reason: unknown) => void, visit: (units: number) => void);
    start(): Promise<void>;
    request(request: EreTransportRequest, posted: () => void): Promise<unknown>;
    close(): Promise<void>;
}
