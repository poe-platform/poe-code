import type { EreExpansionBounds, EreUsage } from "../types.js";
import { TransportAccounting } from "./accounting.js";
import type { EreCleanupRegistration, EreTransportSession } from "./protocol.js";
export declare class EreTransportRoot {
    #private;
    constructor(bounds: EreExpansionBounds, registerCleanup: EreCleanupRegistration);
    get usage(): Readonly<{
        engine: EreUsage;
        transport: TransportAccounting["usage"];
    }>;
    openSession(registerCleanup: EreCleanupRegistration): EreTransportSession;
    close(): Promise<void>;
}
