import { createAgentCommands } from "virtual:safe-bash-kernel";
import type { ShellLimits, VirtualShellPlugin } from "safe-bash-engine/safe-bash";

export {
  Shell,
  createMemoryFileSystem,
  resolvePath,
  normalizePath,
  readBytes,
  FsError
} from "virtual:safe-bash-kernel";
export type {
  FileSystem,
  ShellResult,
  ShellOptions,
  CommandDefinition,
  VirtualShellPlugin
} from "safe-bash-engine/safe-bash";
export type { ShellExecOptions, RootShellState } from "virtual:safe-bash-kernel";

export const browserLimits: Readonly<ShellLimits> = Object.freeze({
  maxInputBytes: 4 * 1024 * 1024,
  maxOutputBytes: 64 * 1024,
  maxCommands: 1000,
  maxLoopIterations: 1000,
  maxSubstitutionDepth: 16,
  maxSourceBytes: 16 * 1024,
  maxExpansionFields: 1000,
  maxExpansionBytes: 64 * 1024,
  maxWallClockMs: 5_000,
  maxCpuMs: 5_000,
  pipeHighWaterMark: 16 * 1024
});

const commands = createAgentCommands();
export const supportedCommands: readonly string[] = Object.freeze(
  commands.map((command) => command.name).sort()
);

export function browserCommands(): VirtualShellPlugin {
  return {
    name: "browser-agent-commands",
    setup(host) {
      for (const command of commands) {
        if (host.commands.has(command.name))
          throw new Error(`Command already registered: ${command.name}`);
      }
      for (const command of commands) host.commands.register(command);
    }
  };
}
