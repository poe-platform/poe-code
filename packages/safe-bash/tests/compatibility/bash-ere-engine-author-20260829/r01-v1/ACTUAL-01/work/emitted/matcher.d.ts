import { EreLedger } from "./limits.js";
import type { EreProgram, EreResult } from "./types.js";
export declare function matchEre(program: EreProgram, subject: string, ledger: EreLedger, signal?: AbortSignal): Promise<EreResult>;
