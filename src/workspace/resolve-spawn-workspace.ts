import type { SpawnMode } from "@poe-code/agent-spawn";
import { parseLocator, resolveWorkspace } from "@poe-code/workspace-resolver";
import type { CommandRunner } from "../utils/command-checks.js";
import type { FileSystem } from "../utils/file-system.js";

export interface SpawnWorkspaceResolution {
  cwd?: string;
  cleanup?: () => Promise<void>;
}

export async function resolveSpawnWorkspace(
  candidate: string | undefined,
  options: {
    baseDir: string;
    homeDir: string;
    mode?: SpawnMode;
    resolveRemoteLocators?: boolean;
    fs: Pick<FileSystem, "mkdir" | "stat" | "rm">;
    exec: CommandRunner;
  }
): Promise<SpawnWorkspaceResolution> {
  if (!candidate || candidate.trim().length === 0) {
    return {};
  }

  const locator = parseLocator(candidate);
  if (locator.scheme !== "local" && options.resolveRemoteLocators === false) {
    return {
      cwd: candidate
    };
  }

  const resolved = await resolveWorkspace(candidate, {
    baseDir: options.baseDir,
    homeDir: options.homeDir,
    mode: options.mode,
    fs: {
      mkdir: options.fs.mkdir,
      stat: options.fs.stat,
      ...(options.fs.rm ? { rm: options.fs.rm } : {})
    },
    exec: async (
      command: string,
      args: string[],
      execOptions?: { cwd?: string }
    ) =>
      await options.exec(command, args, execOptions ? { cwd: execOptions.cwd } : undefined)
  });

  return {
    cwd: resolved.cwd,
    cleanup: resolved.cleanup
  };
}
