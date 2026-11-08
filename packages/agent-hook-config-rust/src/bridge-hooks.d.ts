import { type HookDrop } from "./transform-hooks.js";
/** Strategy a caller can ask for; `auto` picks a working one. */
export type BridgeStrategyRequest = "auto" | "symlink" | "transform";
/** Strategy a run actually resolved to; `skip` means existing hooks were left alone. */
export type BridgeStrategy = "symlink" | "transform" | "skip";
export interface BridgeHookManifest {
    sourceAgentId: string;
    targetAgentId: string;
    cwd: string;
    runId: string;
    strategy: BridgeStrategy;
    writtenPath?: string;
    generatedEntryIds?: string[];
    drops: HookDrop[];
    symlinkPath?: string;
    symlinkTarget?: string;
    symlinkReplaced?: "none" | "stale-symlink" | "generated-file";
    symlinkCreated?: boolean;
    /** Non-fatal notices raised while bridging, e.g. why `auto` skipped. */
    warnings?: string[];
    createdParents?: string[];
    preExistingEvents?: string[];
    preExistingMatchers?: Array<{
        event: string;
        matcher?: string;
    }>;
    fileCreated?: boolean;
}
export declare function bridgeHooks(sourceAgentId: string, targetAgentId: string, cwd: string, homeDir: string, runId: string, opts?: {
    strategy?: BridgeStrategyRequest;
    scope?: "project" | "user" | "merged";
}): BridgeHookManifest;
export declare function cleanupBridgedHooks(manifest: BridgeHookManifest): void;
