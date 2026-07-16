import type {
  CommandRunner,
  CommandRunnerOptions,
  CommandRunnerResult
} from "@poe-code/agent-spawn";
import { buildSpawnArgs, type HookBridgeOptions } from "@poe-code/agent-spawn";
import { createBinaryExistsDetectors } from "@poe-code/agent-harness-tools";
import { ValidationError } from "../cli/errors.js";
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

const VERBOSE_STREAM_HINT = "Re-run with --verbose to see the full agent output.";
const MAX_CAUSE_LENGTH = 200;

/**
 * A health check answers one question, so its failure reports the cause rather than the
 * whole stream. The stream stays available behind --verbose for diagnosis.
 */
function describeFailureDetail(
  result: CommandRunnerResult,
  verbose: boolean | undefined
): string {
  if (verbose) {
    return formatCommandRunnerResult(result);
  }
  const cause = summarizeFailureCause(result);
  return cause === undefined ? VERBOSE_STREAM_HINT : `Cause: ${cause}\n${VERBOSE_STREAM_HINT}`;
}

function summarizeFailureCause(result: CommandRunnerResult): string | undefined {
  return firstReportedMessage(result.stderr) ?? firstReportedMessage(result.stdout);
}

function firstReportedMessage(output: string): string | undefined {
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const message = trimmed[0] === "{" ? readJsonMessage(trimmed) : trimmed;
    if (message !== undefined) {
      return message.length > MAX_CAUSE_LENGTH
        ? `${message.slice(0, MAX_CAUSE_LENGTH)}…`
        : message;
    }
  }
  return undefined;
}

/**
 * Stream agents report over JSONL where most lines are protocol bookkeeping and only a
 * few carry words meant for a human. Reading the text-bearing fields finds the cause
 * without reprinting the stream, and is agent-agnostic: every agent names them the same.
 */
function readJsonMessage(line: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return line;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }
  for (const field of ["error", "message", "result", "text"]) {
    const value = (parsed as Record<string, unknown>)[field];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
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
    const detail = describeFailureDetail(result, context.verbose);
    throw new Error(
      [`Command ${rendered} failed with exit code ${result.exitCode}.`, detail].join("\n")
    );
  }

  if (!stdoutMatchesExpected(result.stdout, options.expectedOutput)) {
    const detail = describeFailureDetail(result, context.verbose);
    const received = summarizeFailureCause(result) ?? "<no output>";
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
  /** Reports the command's raw output on failure instead of a summarised cause. */
  verbose?: boolean;
  logDryRun?: (message: string) => void;
  logWarning?: (message: string) => void;
}

export interface CommandCheck {
  id: string;
  description?: string;
  run(context: CommandCheckContext): Promise<void>;
}

/**
 * Agents report an unresolvable model id in their own words, but they all name it the
 * same way. Matching the shared wording keeps this mapping agent-agnostic.
 */
const MODEL_NOT_FOUND_SIGNALS = ["model not found", "modelnotfounderror"];

function indicatesModelNotFound(result: CommandRunnerResult): boolean {
  const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return MODEL_NOT_FOUND_SIGNALS.some((signal) => output.includes(signal));
}

/**
 * Echoes the model id poe-code actually sent. Providers may namespace the id the user
 * asked for (OpenCode receives `poe/<owner>/<model>`), so the sent id is the one the
 * agent rejected and the one the user cannot otherwise see.
 */
function createModelNotFoundError(agentId: string, model: string | undefined): ValidationError {
  const subject = model === undefined ? "the model" : `model id "${model}"`;
  return new ValidationError(
    [
      `${agentId} could not find ${subject}, which is the id poe-code sent to it.`,
      `Run "poe-code models" to list available model ids, then "poe-code configure ${agentId} --model <id>".`
    ].join("\n")
  );
}

export function createSpawnHealthCheck(
  agentId: string,
  options: {
    /** Model id sent to the agent; echoed back when the agent cannot resolve it. */
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

      const failed =
        result.exitCode !== 0 || !result.stdout.includes(options.expectedOutput);
      if (failed && indicatesModelNotFound(result)) {
        throw createModelNotFoundError(agentId, options.model);
      }

      if (result.exitCode !== 0) {
        throw new Error(
          `spawn ${agentId} failed with exit code ${result.exitCode}.\n${describeFailureDetail(result, context.verbose)}`
        );
      }

      if (!result.stdout.includes(options.expectedOutput)) {
        throw new Error(
          `spawn ${agentId}: expected "${options.expectedOutput}" in stdout.\n${describeFailureDetail(result, context.verbose)}`
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
