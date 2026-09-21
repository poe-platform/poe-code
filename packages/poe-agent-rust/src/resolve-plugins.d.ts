import type { AgentPlugin } from "./plugin-types.js";
export type PluginConfigEntry = {
    name: string;
    options?: unknown;
};
export declare class PluginConfigError extends Error {
    constructor(message: string);
}
export declare function parsePluginConfigEntry(input: unknown): PluginConfigEntry;
export declare function parsePluginConfigEntries(input: unknown): PluginConfigEntry[];
export declare function parseNullablePluginConfigEntries(input: unknown): PluginConfigEntry[] | null;
export declare function resolvePluginsFromConfig(entries: PluginConfigEntry[]): AgentPlugin[];
