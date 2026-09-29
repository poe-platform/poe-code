import {
  createGitCommand as createBaseGitCommand,
  createGitCommands as createBaseGitCommands,
  gitCommands as baseGitCommands,
  evalSyncGit,
  type GitCommandsOptions,
  type GitHttpRequest,
  type GitHttpResponse,
  type GitLimits,
  type SyncGitNodeInfo
} from "safe-bash-command-git";
import { builtInDirectContextExecutors } from "../internal.js";
import { type CommandDefinition, type VirtualShellPlugin } from "../../contracts/index.js";

export { evalSyncGit };
export type { GitCommandsOptions, GitHttpRequest, GitHttpResponse, GitLimits, SyncGitNodeInfo };

function isDefaultOptions(options?: GitCommandsOptions): boolean {
  return options === undefined || (
    options.http === undefined &&
    options.wasmModule === undefined &&
    options.limits === undefined
  );
}

export function createGitCommand(options: GitCommandsOptions = {}): CommandDefinition {
  const def = createBaseGitCommand(options);
  if (isDefaultOptions(options)) {
    builtInDirectContextExecutors.add(def.execute);
  }
  return def;
}

export function createGitCommands(options: GitCommandsOptions = {}): readonly CommandDefinition[] {
  const defs = createBaseGitCommands(options);
  if (isDefaultOptions(options)) {
    for (const def of defs) builtInDirectContextExecutors.add(def.execute);
  }
  return defs;
}

export function gitCommands(options: GitCommandsOptions = {}): VirtualShellPlugin {
  const commands = createGitCommands(options);
  return {
    name: "git-commands",
    setup(host) {
      for (const command of commands) {
        host.commands.register(command, { replace: options.replace ?? false });
      }
    }
  };
}
