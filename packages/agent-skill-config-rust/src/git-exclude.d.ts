export type GitDirRunner = (cwd: string) => string | undefined;
export declare function setGitDirRunnerForTest(runner: GitDirRunner): () => void;
export declare function appendExcludeBlock(cwd: string, runId: string, entries: string[], opts?: {
    markerPrefix?: string;
}): string | undefined;
export declare function removeExcludeBlock(cwd: string, runId: string, opts?: {
    markerPrefix?: string;
}): void;
