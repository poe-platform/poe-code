import os from "node:os";
import path from "node:path";
import * as nodeFs from "node:fs/promises";
import { UserError } from "toolcraft";
import {
  getAgentConfig,
  resolveAgentSupport as resolveSkillAgentSupport,
  supportedAgents as skillSupportedAgents
} from "@poe-code/agent-skill-config";
import { hasOwnErrorCode } from "../errors.js";

export type TerminalPilotInstallerFileSystem = {
  readFile(path: string, encoding: "utf8"): Promise<string>;
  writeFile(
    path: string,
    content: string,
    options?: { encoding: "utf8" }
  ): Promise<void>;
  mkdir(path: string, options?: { recursive: boolean }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
  rm?(
    path: string,
    options?: { recursive?: boolean; force?: boolean }
  ): Promise<void>;
  stat(path: string): Promise<{ mode?: number }>;
  lstat(path: string): Promise<{ isSymbolicLink(): boolean }>;
  readdir(path: string): Promise<string[]>;
  chmod?(path: string, mode: number): Promise<void>;
};

export type TerminalPilotInstallScope = "global" | "local";
export type TerminalPilotInstallerPlatform = "darwin" | "linux" | "win32";

export const DEFAULT_INSTALL_AGENT = "claude-code";
export const DEFAULT_INSTALL_SCOPE: TerminalPilotInstallScope = "local";
export const TERMINAL_PILOT_SKILL_NAME = "terminal-pilot";
export const installableAgents = skillSupportedAgents;

export type TerminalPilotInstallerServices = {
  fs?: TerminalPilotInstallerFileSystem;
  cwd?: string;
  homeDir?: string;
  platform?: TerminalPilotInstallerPlatform;
};

function isNotFoundError(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT");
}

export function resolveInstallerServices(
  installer: TerminalPilotInstallerServices | undefined
): Required<TerminalPilotInstallerServices> {
  return {
    fs: installer?.fs ?? (nodeFs as TerminalPilotInstallerFileSystem),
    cwd: installer?.cwd ?? process.cwd(),
    homeDir: installer?.homeDir ?? os.homedir(),
    platform: installer?.platform ?? (process.platform as TerminalPilotInstallerPlatform)
  };
}

function throwUnsupportedAgent(agent: string): never {
  throw new UserError(`Unsupported agent: ${agent}`);
}

export function resolveInstallableAgent(agent: string): string {
  const skillSupport = resolveSkillAgentSupport(agent);

  if (
    skillSupport.status !== "supported" ||
    !skillSupport.id
  ) {
    throwUnsupportedAgent(agent);
  }

  return skillSupport.id;
}

export function resolveInstallScope(input: {
  local?: boolean;
  global?: boolean;
}): TerminalPilotInstallScope {
  if (input.local && input.global) {
    throw new UserError("Use either --local or --global, not both.");
  }

  if (input.local) {
    return "local";
  }

  if (input.global) {
    return "global";
  }

  return DEFAULT_INSTALL_SCOPE;
}

let terminalPilotTemplateCache: string | undefined;

export async function loadTerminalPilotTemplate(): Promise<string> {
  if (terminalPilotTemplateCache !== undefined) {
    return terminalPilotTemplateCache;
  }

  try {
    terminalPilotTemplateCache = await nodeFs.readFile(
      new URL("../templates/terminal-pilot.md", import.meta.url),
      "utf8"
    );
    return terminalPilotTemplateCache;
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  throw new UserError("terminal-pilot skill template is missing.");
}

function resolveHomeRelativePath(targetPath: string, homeDir: string): string {
  if (targetPath === "~") {
    return homeDir;
  }

  if (targetPath.startsWith("~/")) {
    return path.join(homeDir, targetPath.slice(2));
  }

  return targetPath;
}

export function getSkillFolderWithHome(
  agent: string,
  scope: TerminalPilotInstallScope,
  cwd: string,
  homeDir: string
): {
  displayPath: string;
  fullPath: string;
} {
  const config = getAgentConfig(agent);

  if (!config) {
    throwUnsupportedAgent(agent);
  }

  return {
    displayPath: path.join(
      scope === "global" ? config.globalSkillDir : config.localSkillDir,
      TERMINAL_PILOT_SKILL_NAME
    ),
    fullPath: path.join(
      scope === "global"
        ? resolveHomeRelativePath(config.globalSkillDir, homeDir)
        : path.resolve(cwd, config.localSkillDir),
      TERMINAL_PILOT_SKILL_NAME
    )
  };
}

export async function removeSkillFolder(
  fs: TerminalPilotInstallerFileSystem,
  folderPath: string
): Promise<boolean> {
  await assertNoSymbolicLinkPath(fs, folderPath);

  try {
    await fs.stat(folderPath);
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }

  if (typeof fs.rm !== "function") {
    throw new UserError("The configured filesystem does not support removing directories.");
  }

  await fs.rm(folderPath, { recursive: true, force: true });
  return true;
}

export async function assertNoSymbolicLinkPath(
  fs: Pick<TerminalPilotInstallerFileSystem, "lstat">,
  targetPath: string
): Promise<void> {
  const rootPath = path.parse(targetPath).root;
  let currentPath = targetPath;

  while (currentPath !== rootPath) {
    try {
      if ((await fs.lstat(currentPath)).isSymbolicLink()) {
        throw new UserError(`Refusing terminal-pilot skill operation through symbolic link: ${currentPath}`);
      }
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }

    currentPath = path.dirname(currentPath);
  }
}
