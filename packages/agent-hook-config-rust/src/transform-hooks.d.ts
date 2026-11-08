import type { HookEvent } from "./configs.js";
import type { SourceHookEntry } from "./read-hooks.js";
export interface GeneratedHookEntry {
    event: HookEvent;
    matcher?: string;
    handler: {
        type: "command";
        command: string;
        args?: string[];
        timeout?: number;
        statusMessage: string;
    };
    /** Stable id derived from the source so two transform runs yield the same id for the same source entry. */
    generatedId: string;
}
export interface HookDrop {
    reason: "unsupported-event" | "unsupported-handler-type";
    detail: string;
    source: SourceHookEntry;
}
export interface TransformResult {
    entries: GeneratedHookEntry[];
    drops: HookDrop[];
}
export declare function transformHooks(source: SourceHookEntry[], sourceAgentId: string, targetAgentId: string, opts: {
    runId: string;
}): TransformResult;
