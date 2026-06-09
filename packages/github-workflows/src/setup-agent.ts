import type { CommandRunner, CommandRunnerResult } from "@poe-code/agent-spawn";
import { runCommand } from "@poe-code/agent-spawn";
import { UserError } from "toolcraft";
import { workflowSubprocessTimeoutMs } from "./subprocess-timeout.js";
import type { AutomationDefinition } from "./types.js";

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

function trimOutput(value: string): string {
  return value.trim();
}

export function resolveWorkflowAgent(automation: AutomationDefinition): string {
  const configured = automation.agent?.trim();
  return configured && configured.length > 0 ? configured : "codex";
}

export function formatCommandFailure(command: string, args: string[], result: CommandRunnerResult): string {
  const stderr = trimOutput(result.stderr);
  const stdout = trimOutput(result.stdout);

  return [
    `Command failed with exit code ${result.exitCode}: ${formatCommand(command, args)}`,
    stderr.length > 0 ? `stderr:\n${stderr}` : null,
    stdout.length > 0 ? `stdout:\n${stdout}` : null
  ]
    .filter((value): value is string => value !== null)
    .join("\n");
}

async function runPoeCodeCommand(
  args: string[],
  cwd: string,
  runner: CommandRunner
): Promise<void> {
  const result = await runner("poe-code", args, {
    cwd,
    timeoutMs: workflowSubprocessTimeoutMs
  });
  if (result.exitCode !== 0) {
    throw new UserError(formatCommandFailure("poe-code", args, result));
  }
}

export async function setupWorkflowAgent(
  automation: AutomationDefinition,
  cwd: string,
  runner: CommandRunner = runCommand
): Promise<string> {
  const agent = resolveWorkflowAgent(automation);

  await runPoeCodeCommand(["install", agent, "--yes"], cwd, runner);
  await runPoeCodeCommand(["configure", agent, "--yes"], cwd, runner);

  return agent;
}
