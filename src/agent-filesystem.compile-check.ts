import type { AgentOptions, AgentRuntime, PluginApi, ToolContext } from "./agent.js";
import type { FileSystem, NodeFsImplementation } from "@poe-code/safe-fs";
import type { InstallSkillFileSystem } from "./skills.js";

type Assert<T extends true> = T;
export type SharedProviderContract = Assert<
  FileSystem extends NonNullable<AgentOptions["fs"]> ? true : false
>;
export type SetupProviderContract = Assert<PluginApi["fs"] extends FileSystem ? true : false>;
export type ToolRuntimeContract = Assert<
  NonNullable<ToolContext["runtime"]> extends AgentRuntime ? true : false
>;
export type SkillBridgeContract = Assert<
  NodeFsImplementation extends InstallSkillFileSystem ? true : false
>;

import type { agent, skillsPlugin } from "./agent.js";
export type PublicAgentOptionsContract = Assert<AgentOptions extends NonNullable<Parameters<typeof agent>[0]> ? true : false>;
export type PublicSkillCatalogContract = Assert<{ directories: string[] } extends NonNullable<Parameters<typeof skillsPlugin>[0]> ? true : false>;
