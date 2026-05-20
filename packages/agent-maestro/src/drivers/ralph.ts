import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isActivityTimeoutError } from "@poe-code/agent-spawn";
import {
  runRalph,
  type AgentRunInput,
  type RalphRunOptions,
  type RalphRunResult
} from "@poe-code/ralph";

import type { AttemptOutcome } from "../agent/runner.js";
import type { AttemptPhase, FailureCategory } from "../runtime/phases.js";
import type { WorkflowDriver, WorkflowDriverContext } from "./types.js";

type RalphRunner = (options: RalphRunOptions) => Promise<RalphRunResult>;
type RalphResultWithFailure = Omit<RalphRunResult, "stopReason"> & {
  stopReason: RalphRunResult["stopReason"] | "timeout";
  failure?: FailureCategory;
  failureCategory?: FailureCategory;
};
type RalphAgentRunInput = AgentRunInput & {
  mode?: import("@poe-code/agent-spawn").SpawnMode;
};

export function createRalphDriver(options: { runRalph?: RalphRunner } = {}): WorkflowDriver {
  const runner = options.runRalph ?? runRalph;

  return {
    kind: "ralph",
    async run(ctx) {
      return runRalphDriver(ctx, runner);
    }
  };
}

export const ralphDriver: WorkflowDriver = createRalphDriver();

async function runRalphDriver(
  ctx: WorkflowDriverContext,
  runner: RalphRunner
): Promise<AttemptOutcome> {
  if (ctx.planPath == null) {
    return fail("step_failed", "ralph driver requires a file-backed task");
  }

  const workspaceDocPath = path.join(ctx.workspaceDir, path.basename(ctx.planPath));

  try {
    await fs.mkdir(ctx.workspaceDir, { recursive: true });
    await fs.copyFile(ctx.planPath, workspaceDocPath);
  } catch (error) {
    return fail("step_failed", errorMessage(error));
  }

  emitPhase(ctx, null, "running-step", "ralph");

  try {
    const result = await runner({
      cwd: ctx.workspaceDir,
      homeDir: os.homedir(),
      docPath: workspaceDocPath,
      runAgent: (input) => runAgent(ctx, input),
      onIterationComplete: (iteration, durationMs, success) => {
        ctx.emit({
          type: "agent_event",
          task_id: ctx.task.qualifiedId,
          step: "ralph",
          session_id: "",
          event: "iteration_complete",
          payload: { iteration, durationMs, success }
        });
      },
      signal: ctx.abort
    });

    if (isCancelled(result)) {
      emitPhase(ctx, "running-step", "canceled", "ralph", "canceled");
      return { reason: "abnormal", failure: "canceled" };
    }

    if (isTimeout(result)) {
      const outcome = fail("step_timeout", "ralph reported timeout");
      emitPhase(ctx, "running-step", "failed", "ralph", outcome.failure);
      return outcome;
    }

    if (result.stopReason === "failed") {
      const failure = readReportedFailure(result) ?? "step_failed";
      const outcome = fail(failure, `ralph reported ${failure}`);
      emitPhase(ctx, "running-step", "failed", "ralph", outcome.failure);
      return outcome;
    }

    await persistPlan(workspaceDocPath, ctx.planPath);
    emitPhase(ctx, "running-step", "succeeded", "ralph");
    return { reason: "normal" };
  } catch (error) {
    if (ctx.abort.aborted || isAbortError(error)) {
      emitPhase(ctx, "running-step", "canceled", "ralph", "canceled");
      return { reason: "abnormal", failure: "canceled" };
    }

    const failure = isActivityTimeoutError(error) ? "step_timeout" : "step_failed";
    const outcome = fail(failure, errorMessage(error));
    emitPhase(ctx, "running-step", "failed", "ralph", outcome.failure);
    return outcome;
  }
}

async function runAgent(
  ctx: WorkflowDriverContext,
  input: RalphAgentRunInput
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = await ctx.spawn(input.agent, {
    cwd: input.cwd,
    prompt: input.prompt,
    model: input.model,
    mode: input.mode,
    signal: input.signal
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode
  };
}

async function persistPlan(workspaceDocPath: string, planPath: string): Promise<void> {
  const updatedDocPath = await resolveUpdatedDocPath(workspaceDocPath);
  const content = await fs.readFile(updatedDocPath, "utf8");
  const tempPath = path.join(
    path.dirname(planPath),
    `.${path.basename(planPath)}.${process.pid}.tmp`
  );

  if (updatedDocPath !== workspaceDocPath) {
    await fs.writeFile(workspaceDocPath, content, "utf8");
  }

  await fs.writeFile(tempPath, content, "utf8");
  await fs.rename(tempPath, planPath);
}

async function resolveUpdatedDocPath(workspaceDocPath: string): Promise<string> {
  if (await fileExists(workspaceDocPath)) {
    return workspaceDocPath;
  }

  const archivedPath = path.join(
    path.dirname(workspaceDocPath),
    "archive",
    path.basename(workspaceDocPath)
  );
  if (await fileExists(archivedPath)) {
    return archivedPath;
  }

  return workspaceDocPath;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }

    throw error;
  }
}

function fail(failure: FailureCategory, error: string): AttemptOutcome {
  return {
    reason: "abnormal",
    failure,
    failedStep: "ralph",
    error
  };
}

function emitPhase(
  ctx: WorkflowDriverContext,
  from: AttemptPhase | null,
  to: AttemptPhase,
  step: string,
  failure?: FailureCategory
): void {
  ctx.emit({
    type: "attempt_phase",
    task_id: ctx.task.qualifiedId,
    from,
    to,
    step: to === "running-step" ? step : undefined,
    failure
  });
}

function isCancelled(result: RalphRunResult): boolean {
  return result.stopReason === "cancelled";
}

function isTimeout(result: RalphRunResult): boolean {
  return (result as RalphResultWithFailure).stopReason === "timeout";
}

function readReportedFailure(result: RalphRunResult): FailureCategory | undefined {
  const resultWithFailure = result as RalphResultWithFailure;
  return readFailureCategory(resultWithFailure.failure ?? resultWithFailure.failureCategory);
}

function readFailureCategory(value: unknown): FailureCategory | undefined {
  if (
    value === "workspace_error" ||
    value === "prompt_render_error" ||
    value === "agent_startup_error" ||
    value === "step_failed" ||
    value === "step_timeout" ||
    value === "agent_crashed"
  ) {
    return value;
  }

  return undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isMissingPathError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
