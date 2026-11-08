import { type SpawnSyncReturns, spawnSync } from "node:child_process";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunnerOptions {
  cwd?: string;
  input?: string;
}

const COMMAND_OUTPUT_MAX_BUFFER = 50 * 1024 * 1024;

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options?: CommandRunnerOptions
) => CommandResult;

export const defaultCommandRunner: CommandRunner = (command, args, options = {}) => {
  const result: SpawnSyncReturns<string> = spawnSync(command, args, {
    cwd: options.cwd,
    input: options.input,
    encoding: "utf-8",
    maxBuffer: COMMAND_OUTPUT_MAX_BUFFER
  });

  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
};
