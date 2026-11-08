export interface SkillSource {
    kind: "resolved";
    ref: string;
    name: string;
    sourceAgentId?: string;
    sourcePath: string;
    scope: "project" | "user";
}
export type SkillResolutionFailure = {
    kind: "malformed";
    ref: string;
} | {
    kind: "unknown-agent";
    ref: string;
    agentInput: string;
} | {
    kind: "not-found";
    ref: string;
    searchedPaths: string[];
};
export type SkillResolution = SkillSource | SkillResolutionFailure;
export declare function resolveSkillReference(ref: string, cwd: string, homeDir: string): SkillResolution;
