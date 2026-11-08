export interface CommandRunnerResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
  aborted?: boolean;
}
export interface CommandRunnerOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdin?: string | Buffer;
  timeoutMs?: number;
  signal?: AbortSignal;
}
export type CommandRunner = (
  command: string,
  args: string[],
  options?: CommandRunnerOptions
) => Promise<CommandRunnerResult>;
export declare function runCommand(
  command: string,
  args: string[],
  inputOptions?: CommandRunnerOptions
): Promise<CommandRunnerResult>;
