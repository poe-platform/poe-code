import { EreLedger } from "./limits.js";
import type { EreFragment, EreNode, EreProgram } from "./types.js";
export declare function admitAscii(text: string, ledger: EreLedger, signal?: AbortSignal): Promise<void>;
export declare function compileEre(input: string | readonly EreFragment[], ledger: EreLedger, signal?: AbortSignal): Promise<EreProgram>;
export declare function resolveEreProgram(program: EreProgram, ledger: EreLedger): EreNode;
