import { randomUUID } from "node:crypto";
import { defineCommand, S } from "toolcraft";
import { hasOwnErrorCode } from "../errors.js";
import type { TerminalPilotCommandServices } from "./runtime.js";
import {
  DEFAULT_INSTALL_AGENT,
  assertNoSymbolicLinkPath,
  getSkillFolderWithHome,
  installableAgents,
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
    const skills = [localSkill, globalSkill];
    const staged: Array<{ fullPath: string; stagingPath: string; displayPath: string }> = [];

    try {
      for (const skill of skills) {
        await assertNoSymbolicLinkPath(services.fs, skill.fullPath);

        if (!(await folderExists(services.fs, skill.fullPath))) {
          continue;
        }

        const stagingPath = `${skill.fullPath}.removing-${randomUUID()}`;
        await services.fs.rename(skill.fullPath, stagingPath);
        staged.push({ ...skill, stagingPath });
      }
    } catch (error) {
      for (const skill of staged.reverse()) {
        await services.fs.rename(skill.stagingPath, skill.fullPath);
      }
      throw error;
    }

    if (typeof services.fs.rm === "function") {
      await Promise.allSettled(
        staged.map((skill) => services.fs.rm!(skill.stagingPath, { recursive: true, force: true }))
      );
    }

    return {
      agent,
      removedSkillPaths: staged.map((skill) => skill.displayPath)
    };
  }
});

async function folderExists(
  fs: ReturnType<typeof resolveInstallerServices>["fs"],
  folderPath: string
): Promise<boolean> {
  try {
    await fs.stat(folderPath);
    return true;
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return false;
    }

    throw error;
  }
}
