import { defineCommand, S } from "agent-kit";
import type { TerminalPilotCommandServices } from "./runtime.js";
import {
  DEFAULT_INSTALL_AGENT,
  getSkillFolderWithHome,
  installableAgents,
  removeSkillFolder,
  resolveInstallableAgent,
  resolveInstallerServices
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
  },
  readonly ["cli"]
>({
  name: "uninstall",
  description: "Remove the terminal-pilot CLI skill.",
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

    return {
      agent,
      removedSkillPaths
    };
  }
});
