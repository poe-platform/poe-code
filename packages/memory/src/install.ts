import path from "node:path";
import { installSkill } from "@poe-code/agent-skill-config";
import { configure, resolveAgentSupport } from "@poe-code/agent-mcp-config";
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
  /** Overwrite an existing memory SKILL.md instead of failing. */
  force?: boolean;
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
        force: options.force,
        dryRun: options.dryRun,
        observers: options.observers
      }
    );

    skillPath = installed.displayPath;
  }

  let mcpConfigPath: string | undefined;

  if (!options.skillOnly) {
    try {
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
    } catch (error) {
      if (skillPath !== undefined && options.dryRun !== true) {
        await removeInstalledSkill(options, skillPath).catch(() => undefined);
      }
      throw error;
    }

    mcpConfigPath = resolveMcpConfigPath(options.agent, options.homeDir, options.platform);
  }

  return {
    skillInstalled: !options.mcpOnly,
    mcpConfigured: !options.skillOnly,
    skillPath,
    mcpConfigPath
  };
}

function resolveMcpConfigPath(
  agent: string,
  homeDir: string,
  platform: McpApplyOptions["platform"]
): string {
  const support = resolveAgentSupport(agent);
  if (support.status !== "supported" || support.config === undefined) {
    throw new Error(`Unsupported agent: ${agent}`);
  }

  const configFile =
    typeof support.config.configFile === "function"
      ? support.config.configFile(platform)
      : support.config.configFile;
  return configFile.startsWith("~/") ? path.join(homeDir, configFile.slice(2)) : configFile;
}

async function removeInstalledSkill(
  options: Pick<MemoryInstallOptions, "fs" | "cwd" | "homeDir" | "scope">,
  skillPath: string
): Promise<void> {
  const baseDir = options.scope === "global" ? options.homeDir : options.cwd;
  const displayPath = skillPath.startsWith("~/") ? skillPath.slice(2) : skillPath;
  const skillDirectory = path.join(baseDir, path.dirname(displayPath));

  if (options.fs.rm !== undefined) {
    await options.fs.rm(skillDirectory, { recursive: true, force: true });
    return;
  }

  await options.fs.unlink(path.join(skillDirectory, "SKILL.md"));
}
