export interface AgentSkillConfig {
    globalSkillDir: string;
    localSkillDir: string;
    /** Set only when the directories deviate from the agent's own dot-directory. */
    dirNote?: string;
}
export type SkillScope = "global" | "local";
export declare const supportedAgents: readonly string[];
export type AgentSupportStatus = "supported" | "unsupported" | "unknown";
export interface AgentSupportResult {
    status: AgentSupportStatus;
    input: string;
    id?: string;
    config?: AgentSkillConfig;
}
export declare function resolveAgentSupport(input: string, registry?: Record<string, AgentSkillConfig>): AgentSupportResult;
export declare function getAgentConfig(agentId: string): AgentSkillConfig | undefined;
export declare function resolveSkillDir(config: AgentSkillConfig, scope: SkillScope, cwd: string, homeDir?: string): string;
