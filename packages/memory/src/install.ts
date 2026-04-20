import { installSkill } from "@poe-code/agent-skill-config";
import { configure } from "@poe-code/agent-mcp-config";
import type { ApplyOptions as McpApplyOptions } from "@poe-code/agent-mcp-config";
import type { FileSystem, MutationObservers } from "@poe-code/config-mutations";
import type { MemoryInstallResult } from "./types.js";

export type MemoryInstallOptions = {
  agent: string;
  skillContent: string;
  fs: FileSystem;
  cwd: string;
  homeDir: string;
  platform: McpApplyOptions["platform"];
  scope?: "local" | "global";
  skillOnly?: boolean;
  mcpOnly?: boolean;
  allowWrites?: boolean;
  dryRun?: boolean;
  observers?: MutationObservers;
};

const SKILL_NAME = "poe-code-memory";

export async function installMemory(
  options: MemoryInstallOptions
): Promise<MemoryInstallResult> {
  if (options.skillOnly && options.mcpOnly) {
    throw new Error("--skill-only and --mcp-only cannot be combined.");
  }

  const scope = options.scope ?? "local";
  let skillPath: string | undefined;

  if (!options.mcpOnly) {
    const installed = await installSkill(
      options.agent,
      {
        name: SKILL_NAME,
        content: options.skillContent
      },
      {
        fs: options.fs,
        cwd: options.cwd,
        homeDir: options.homeDir,
        scope,
        dryRun: options.dryRun,
        observers: options.observers
      }
    );

    skillPath = installed.displayPath;
  }

  let mcpConfigPath: string | undefined;

  if (!options.skillOnly) {
    await configure(
      options.agent,
      {
        name: SKILL_NAME,
        config: {
          transport: "stdio",
          command: "poe-code",
          args: options.allowWrites ? ["memory-mcp", "--allow-writes"] : ["memory-mcp"]
        }
      },
      {
        fs: options.fs,
        homeDir: options.homeDir,
        platform: options.platform,
        dryRun: options.dryRun,
        observers: options.observers
      }
    );

    mcpConfigPath = options.agent === "codex"
      ? `${options.homeDir}/.config/codex/mcp-config.json`
      : `${options.homeDir}/.mcp.json`;
  }

  return {
    skillInstalled: !options.mcpOnly,
    mcpConfigured: !options.skillOnly,
    skillPath,
    mcpConfigPath
  };
}
