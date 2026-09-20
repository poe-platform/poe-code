import type { GeneratedHookEntry } from "./transform-hooks.js";
export interface WriteResult {
    path: string;
    fileCreated: boolean;
    previousGeneratedRemoved: number;
    generatedWritten: number;
}
export declare function writeCodexHooks(targetPath: string, entries: GeneratedHookEntry[], runId: string, opts?: {
    preserveGenerated?: boolean;
}): WriteResult;
