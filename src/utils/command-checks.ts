export interface CommandRunnerResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CommandRunnerOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdin?: string | Buffer;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options?: CommandRunnerOptions
) => Promise<CommandRunnerResult>;

export function formatCommandRunnerResult(
  result: CommandRunnerResult
): string {
  const stdout =
    result.stdout.length > 0 ? result.stdout : "<empty>";
  const stderr =
    result.stderr.length > 0 ? result.stderr : "<empty>";
  return `stdout:\n${stdout}\nstderr:\n${stderr}`;
}

export interface RunAndMatchOutputOptions {
  command: string;
  args: string[];
  expectedOutput: string;
  skipOnDryRun?: boolean;
}

export function describeCommandExpectation(
  command: string,
  args: string[],
  expectedOutput: string
): string {
  return `${renderCommandLine(command, args)} (expecting "${expectedOutput}")`;
}

export interface CommandExpectationCheckOptions
  extends RunAndMatchOutputOptions {
  id: string;
}

export function createCommandExpectationCheck(
  options: CommandExpectationCheckOptions
): CommandCheck {
  return {
    id: options.id,
    description: describeCommandExpectation(
      options.command,
      options.args,
      options.expectedOutput
    ),
    async run(context) {
      await runAndMatchOutput(context, options);
    }
  };
}

export async function runAndMatchOutput(
  context: CommandCheckContext,
  options: RunAndMatchOutputOptions
): Promise<void> {
  const rendered = renderCommandLine(options.command, options.args);
  if (options.skipOnDryRun !== false && context.isDryRun) {
    if (context.logDryRun) {
      context.logDryRun(
        `Dry run: ${rendered} (expecting "${options.expectedOutput}")`
      );
    }
    return;
  }

  const result = await context.runCommand(options.command, options.args);
  if (result.exitCode !== 0) {
    const detail = formatCommandRunnerResult(result);
    throw new Error(
      [`Command ${rendered} failed with exit code ${result.exitCode}.`, detail].join("\n")
    );
  }

  if (!stdoutMatchesExpected(result.stdout, options.expectedOutput)) {
    const detail = formatCommandRunnerResult(result);
    const received = result.stdout.trim();
    throw new Error(
      [
        `Command ${rendered} failed: expected "${options.expectedOutput}" but received "${received}".`,
        detail
      ].join("\n")
    );
  }
}

export function stdoutMatchesExpected(stdout: string, expected: string): boolean {
  const trimmed = stdout.trim();
  if (trimmed === expected) {
    return true;
  }

  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .some((line) => line === expected);
}

function renderCommandLine(command: string, args: string[]): string {
  return [command, ...args].map(quoteIfNeeded).join(" ").trim();
}

function quoteIfNeeded(value: string): string {
  if (value.length === 0) {
    return '""';
  }
  if (needsQuoting(value)) {
    return `"${value.replaceAll('"', '\\"')}"`;
  }
  return value;
}

function needsQuoting(value: string): boolean {
  return (
    value.includes(" ") ||
    value.includes("\t") ||
    value.includes("\n")
  );
}

export interface CommandCheckContext {
  isDryRun: boolean;
  runCommand: CommandRunner;
  logDryRun?: (message: string) => void;
}

export interface CommandCheck {
  id: string;
  description?: string;
  run(context: CommandCheckContext): Promise<void>;
}

/**
 * Creates a check that detects if a binary exists using multiple fallback methods.
 * This is useful in Docker/containerized environments where PATH may not be updated after npm install.
 *
 * @param binaryName - The name of the binary to check for (e.g., "claude", "codex")
 * @param id - Unique identifier for the check
 * @param description - Human-readable description of what's being checked
 * @returns A CommandCheck that verifies the binary using multiple detection methods
 */
export function createBinaryExistsCheck(
  binaryName: string,
  id: string,
  description: string
): CommandCheck {
  return {
    id,
    description,
    async run({ runCommand }) {
      // Common installation paths for CLI tools
      const commonPaths = [
        `/usr/local/bin/${binaryName}`,
        `/usr/bin/${binaryName}`,
        `$HOME/.local/bin/${binaryName}`,
        `$HOME/.claude/local/bin/${binaryName}`
      ];

      const detectors: Array<{
        command: string;
        args: string[];
        validate: (result: CommandRunnerResult) => boolean;
      }> = [
        {
          command: "which",
          args: [binaryName],
          validate: (result) => result.exitCode === 0
        },
        {
          command: "where",
          args: [binaryName],
          validate: (result) =>
            result.exitCode === 0 && result.stdout.trim().length > 0
        },
        // Check common installation paths using shell expansion for $HOME
        {
          command: "sh",
          args: [
            "-c",
            commonPaths.map((p) => `test -f "${p}"`).join(" || ")
          ],
          validate: (result) => result.exitCode === 0
        }
      ];

      for (const detector of detectors) {
        const result = await runCommand(detector.command, detector.args);
        if (detector.validate(result)) {
          return;
        }
      }

      throw new Error(`${binaryName} CLI binary not found on PATH.`);
    }
  };
}
