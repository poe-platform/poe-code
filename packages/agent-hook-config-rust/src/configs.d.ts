export type HookFormat = "claude-settings-json" | "codex-hooks-json" | "codex-config-toml";
export type HookEvent = "SessionStart" | "SessionEnd" | "UserPromptSubmit" | "PreToolUse" | "PostToolUse" | "PermissionRequest" | "Stop" | "StopFailure" | "Notification" | "PreCompact" | "PostCompact" | "SubagentStart" | "SubagentStop";
export type HookHandlerType = "command" | "http" | "mcp_tool" | "prompt" | "agent";
export interface AgentHookConfig {
    /** File where this agent reads hooks. Supports `~` expansion. */
    globalHookPath: string;
    /** Project-relative path, may be undefined for agents without project scope. */
    localHookPath?: string;
    format: HookFormat;
    /** Hooks can be read out of this agent's config, making it usable as a transform source. */
    transformReadable?: boolean;
    /** Hooks can be written into this agent's config, making it usable as a transform target. */
    transformWritable?: boolean;
    /** Events the agent honors. Anything outside this set is dropped at bridge time. */
    supportedEvents: readonly HookEvent[];
    /** Handler types the agent executes. Anything outside this set is dropped. */
    supportedHandlerTypes: readonly HookHandlerType[];
    /**
     * Placeholders the agent recognizes. Bridge consults the source-agent
     * placeholder list to identify tokens that need rewriting and the
     * target-agent list as the canonical destination form.
     */
    placeholders: {
        /** Maps abstract token → concrete substring the agent recognizes. */
        projectDir: string;
        pluginRoot?: string;
        pluginData?: string;
    };
}
export type HookScope = "global" | "local";
export declare const supportedHookAgents: readonly string[];
export type AgentSupportStatus = "supported" | "unsupported" | "unknown";
export interface AgentSupportResult {
    status: AgentSupportStatus;
    input: string;
    id?: string;
    config?: AgentHookConfig;
}
export declare function resolveAgentSupport(input: string, registry?: Record<string, AgentHookConfig>): AgentSupportResult;
export interface TransformPair {
    source: string;
    target: string;
}
/**
 * A transform can run when hooks can be read out of the source, written into
 * the target, and the two speak different formats (same format is a symlink).
 */
export declare function canTransform(source: AgentHookConfig, target: AgentHookConfig): boolean;
/**
 * Source→target pairs the transform strategy can actually bridge, derived from
 * which agents expose readable and writable hook configs.
 */
export declare function supportedTransformPairs(registry?: Record<string, AgentHookConfig>): TransformPair[];
export declare function formatSupportedTransformPairs(): string;
export declare function isTransformSupported(sourceInput: string, targetInput: string): boolean;
export declare function getAgentConfig(agentId: string): AgentHookConfig | undefined;
export declare function resolveHookPath(config: AgentHookConfig, scope: HookScope, cwd: string, homeDir?: string): string | undefined;
