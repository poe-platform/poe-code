import type {
  CommandRunner,
  CommandRunnerOptions,
  CommandRunnerResult
} from "@poe-code/agent-spawn";
import { buildSpawnArgs, type HookBridgeOptions } from "@poe-code/agent-spawn";
import { createBinaryExistsDetectors } from "@poe-code/agent-harness-tools";
import { getCurrentExecutionContext, type ExecutionCommand } from "./execution-context.js";

export type {
  CommandRunner,
  CommandRunnerOptions,
  CommandRunnerResult
} from "@poe-code/agent-spawn";

export function formatCommandRunnerResult(result: CommandRunnerResult): string {
  const stdout = result.stdout.length > 0 ? result.stdout : "<empty>";
  const stderr = result.stderr.length > 0 ? result.stderr : "<empty>";
  return `stdout:\n${stdout}\nstderr:\n${stderr}`;
}

export interface RunAndMatchOutputOptions {
  command: string;
  args: string[];
  expectedOutput: string;
  commandOptions?: CommandRunnerOptions;
  skipOnDryRun?: boolean;
}

export function describeCommandExpectation(
  command: string,
  args: string[],
  expectedOutput: string
): string {
  return `${renderCommandLine(command, args)} (expecting "${expectedOutput}")`;
}

export interface CommandExpectationCheckOptions extends RunAndMatchOutputOptions {
  id: string;
}

export function createCommandExpectationCheck(
  options: CommandExpectationCheckOptions
): CommandCheck {
  return {
    id: options.id,
    description: describeCommandExpectation(options.command, options.args, options.expectedOutput),
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
      context.logDryRun(`Dry run: ${rendered} (expecting "${options.expectedOutput}")`);
    }
    return;
  }

  const result = options.commandOptions
    ? await context.runCommand(options.command, options.args, options.commandOptions)
    : await context.runCommand(options.command, options.args);
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

  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.some((line) => line === expected)) {
    return true;
  }

  for (const line of lines) {
    if (line[0] !== "{") continue;
    try {
      const parsed = JSON.parse(line) as { type?: string; result?: string };
      if (parsed.type === "result" && parsed.result === expected) {
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
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
  return value.includes(" ") || value.includes("\t") || value.includes("\n");
}

export interface CommandCheckContext {
  isDryRun: boolean;
  runCommand: CommandRunner;
  logDryRun?: (message: string) => void;
  logWarning?: (message: string) => void;
}

export interface CommandCheck {
  id: string;
  description?: string;
  run(context: CommandCheckContext): Promise<void>;
}

export function createSpawnHealthCheck(
  agentId: string,
  options: {
    model?: string;
    expectedOutput: string;
    hooks?: HookBridgeOptions;
    invocation?: { command: string; args: string[]; env?: Record<string, string> };
    /** How to re-invoke poe-code itself; defaults to the current execution context. */
    host?: ExecutionCommand;
  }
): CommandCheck {
  const host = options.host ?? getCurrentExecutionContext(import.meta.url).command;
  const {
    binaryName,
    args,
    env: modeEnv
  } = options.hooks
    ? {
        binaryName: host.command,
        args: [
          ...host.args,
          "spawn",
          "--hooks-from",
          options.hooks.from,
          ...(options.hooks.strategy ? ["--hooks-strategy", options.hooks.strategy] : []),
          ...(options.hooks.scope ? ["--hooks-scope", options.hooks.scope] : []),
          ...(options.model ? ["--model", options.model] : []),
          "--mode",
          "yolo",
          agentId,
          `Output exactly: ${options.expectedOutput}`
        ],
        env: undefined
      }
    : options.invocation
      ? {
          binaryName: options.invocation.command,
          args: options.invocation.args,
          env: options.invocation.env
        }
      : buildSpawnArgs(agentId, {
          prompt: `Output exactly: ${options.expectedOutput}`,
          model: options.model,
          mode: "yolo"
        });
  return {
    id: `${agentId}-cli-health`,
    description: `spawn ${agentId} (expecting "${options.expectedOutput}")`,
    async run(context) {
      if (context.isDryRun) {
        context.logDryRun?.(
          `Dry run: ${[binaryName, ...args].join(" ")} (expecting "${options.expectedOutput}")`
        );
        return;
      }

      const result = modeEnv
        ? await context.runCommand(binaryName, args, { env: modeEnv })
        : await context.runCommand(binaryName, args);

      if (options.hooks) {
        for (const line of result.stdout.split("\n")) {
          if (line.includes("Dropped bridged hook event")) {
            context.logWarning?.(line);
          }
        }
      }

      if (result.exitCode !== 0) {
        throw new Error(
          `spawn ${agentId} failed with exit code ${result.exitCode}.\n${formatCommandRunnerResult(result)}`
        );
      }

      if (!result.stdout.includes(options.expectedOutput)) {
        throw new Error(
          `spawn ${agentId}: expected "${options.expectedOutput}" in stdout.\n${formatCommandRunnerResult(result)}`
        );
      }
    }
  };
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
      for (const detector of createBinaryExistsDetectors(binaryName)) {
        const result = await runCommand(detector.command, detector.args);
        if (detector.validate(result)) {
          return;
        }
      }

      throw new Error(`${binaryName} CLI binary not found on PATH.`);
    }
  };
}
