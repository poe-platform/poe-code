import { configure as configureMcp } from "@poe-code/agent-mcp-config";
import { installSkill } from "@poe-code/agent-skill-config";
import { defineCommand, S } from "@poe-code/cmdkit";
import type { TerminalPilotCommandServices } from "./runtime.js";
import {
  DEFAULT_INSTALL_AGENT,
  installableAgents,
  createTerminalPilotMcpServer,
  loadTerminalPilotTemplate,
  resolveInstallScope,
  resolveInstallableAgent,
  resolveInstallerServices,
  TERMINAL_PILOT_SKILL_NAME,
  TERMINAL_PILOT_MCP_SERVER_NAME
} from "./installer.js";

const params = S.Object({
  agent: S.Enum(installableAgents as [string, ...string[]], {
    description: "Agent to install terminal-pilot for",
    default: DEFAULT_INSTALL_AGENT
  }),
  local: S.Optional(S.Boolean({ description: "Install the skill in the current project" })),
  global: S.Optional(S.Boolean({ description: "Install the skill in the user home directory" }))
});

export const install = defineCommand<
  TerminalPilotCommandServices,
  "install",
  typeof params,
  undefined,
  {
    agent: string;
    scope: "local" | "global";
    skillPath: string;
    mcpServerName: string;
  },
  readonly ["cli"]
>({
  name: "install",
  description: "Install the terminal-pilot skill and MCP server registration.",
  scope: ["cli"],
  positional: ["agent"],
  params,
  handler: async ({ params, terminalPilotInstaller }) => {
    const services = resolveInstallerServices(terminalPilotInstaller);
    const agent = resolveInstallableAgent(params.agent);
    const scope = resolveInstallScope(params);
    const template = await loadTerminalPilotTemplate();

    const skillResult = await installSkill(
      agent,
      {
        name: TERMINAL_PILOT_SKILL_NAME,
        content: template
      },
      {
        fs: services.fs,
        cwd: services.cwd,
        homeDir: services.homeDir,
        scope
      }
    );

    await configureMcp(agent, createTerminalPilotMcpServer(), {
      fs: services.fs,
      homeDir: services.homeDir,
      platform: services.platform
    });

    return {
      agent,
      scope,
      skillPath: skillResult.displayPath,
      mcpServerName: TERMINAL_PILOT_MCP_SERVER_NAME
    };
  }
});
