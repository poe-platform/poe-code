import { unconfigure as unconfigureMcp } from "@poe-code/agent-mcp-config";
import { defineCommand, S } from "@poe-code/cmdkit";
import type { TerminalPilotCommandServices } from "./runtime.js";
import {
  DEFAULT_INSTALL_AGENT,
  getSkillFolderWithHome,
  installableAgents,
  removeSkillFolder,
  resolveInstallableAgent,
  resolveInstallerServices,
  TERMINAL_PILOT_MCP_SERVER_NAME
} from "./installer.js";

const params = S.Object({
  agent: S.Enum(installableAgents as [string, ...string[]], {
    description: "Agent to uninstall terminal-pilot from",
    default: DEFAULT_INSTALL_AGENT
  })
});

export const uninstall = defineCommand<
  TerminalPilotCommandServices,
  "uninstall",
  typeof params,
  undefined,
  {
    agent: string;
    removedSkillPaths: string[];
    mcpServerName: string;
  },
  readonly ["cli"]
>({
  name: "uninstall",
  description: "Remove the terminal-pilot skill and MCP server registration.",
  scope: ["cli"],
  positional: ["agent"],
  params,
  handler: async ({ params, terminalPilotInstaller }) => {
    const services = resolveInstallerServices(terminalPilotInstaller);
    const agent = resolveInstallableAgent(params.agent);
    const localSkill = getSkillFolderWithHome(
      agent,
      "local",
      services.cwd,
      services.homeDir
    );
    const globalSkill = getSkillFolderWithHome(
      agent,
      "global",
      services.cwd,
      services.homeDir
    );
    const removedSkillPaths: string[] = [];

    if (await removeSkillFolder(services.fs, localSkill.fullPath)) {
      removedSkillPaths.push(localSkill.displayPath);
    }

    if (await removeSkillFolder(services.fs, globalSkill.fullPath)) {
      removedSkillPaths.push(globalSkill.displayPath);
    }

    await unconfigureMcp(agent, TERMINAL_PILOT_MCP_SERVER_NAME, {
      fs: services.fs,
      homeDir: services.homeDir,
      platform: services.platform
    });

    return {
      agent,
      removedSkillPaths,
      mcpServerName: TERMINAL_PILOT_MCP_SERVER_NAME
    };
  }
});
