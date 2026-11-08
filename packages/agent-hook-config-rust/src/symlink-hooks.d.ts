/** Marks the refusal to clobber a hook file poe-code did not generate. */
export declare const userAuthoredHookFileCode = "POE_USER_AUTHORED_HOOK_FILE";
export interface SymlinkResult {
    /** Where the symlink was placed. */
    symlinkPath: string;
    /** What the symlink points to. */
    targetPath: string;
    replaced: "none" | "stale-symlink" | "generated-file";
}
type SymlinkScope = "project" | "user";
export declare function symlinkHooks(sourceAgentId: string, targetAgentId: string, cwd: string, homeDir: string, scope: SymlinkScope): SymlinkResult;
export {};
