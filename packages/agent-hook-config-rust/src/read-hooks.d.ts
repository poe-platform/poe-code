export interface SourceHookEntry {
    event: string;
    matcher?: string;
    handler: {
        type: string;
        command?: string;
        args?: string[];
        url?: string;
        headers?: Record<string, string>;
        server?: string;
        tool?: string;
        input?: Record<string, unknown>;
        prompt?: string;
        model?: string;
        timeout?: number;
        statusMessage?: string;
        if?: string;
        once?: boolean;
        shell?: string;
    };
}
export interface HookReadResult {
    entries: SourceHookEntry[];
    /** Paths actually read, in order. Empty when no source files existed. */
    readPaths: string[];
}
export declare function readClaudeHooks(cwd: string, homeDir: string, opts?: {
    scope?: "project" | "user" | "merged";
}): HookReadResult;
