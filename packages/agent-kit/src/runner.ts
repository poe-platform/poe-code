import { runWorkflowHook, type RunAgentFn, type WorkflowHook } from "./hooks.js";
import { lockWorkflow } from "./lock.js";
import {
  normalizeParticipantConfig,
  type WorkflowParticipant
} from "./participant.js";
import { runWorkflowStage, type WorkflowStage } from "./stage.js";

export interface WorkflowFileStat {
  isFile(): boolean;
  isDirectory(): boolean;
  mtimeMs: number;
}

export interface WorkflowFileSystem {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rmdir(path: string): Promise<void>;
  stat(path: string): Promise<WorkflowFileStat>;
}

export interface DocumentWorkflowOptions {
  cwd: string;
  homeDir: string;
  docPath: string;
  fs: WorkflowFileSystem;
  runAgent: RunAgentFn;
  readConfig: (content: string) => { frontmatter: any; body: string };
  signal?: AbortSignal;
  onIterationStart?: (iteration: number) => void | Promise<void>;
  onIterationEnd?: (
    iteration: number,
    result: IterationResult
  ) => void | Promise<void>;
}

export type IterationResult = "completed" | "nothing_to_run" | "failed";

interface ParsedWorkflowDocument {
  participants: Record<string, WorkflowParticipant>;
  setup?: WorkflowHook;
  teardown?: WorkflowHook;
  stages: WorkflowStage[];
  maxIterations: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toAbortError(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }

  if (typeof DOMException !== "undefined") {
    return new DOMException(
      reason === undefined ? "This operation was aborted." : String(reason),
      "AbortError"
    );
  }

  return new Error(reason === undefined ? "This operation was aborted." : String(reason));
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }

  throw toAbortError(signal.reason);
}

function parseWorkflowHook(value: unknown, fieldName: string): WorkflowHook | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(`Workflow "${fieldName}" must be an object.`);
  }

  if (typeof value.prompt !== "string" || value.prompt.length === 0) {
    throw new Error(`Workflow "${fieldName}" must define a non-empty prompt.`);
  }

  if (value.participant !== undefined && typeof value.participant !== "string") {
    throw new Error(`Workflow "${fieldName}" participant must be a string.`);
  }

  if (
    value.mode !== undefined &&
    value.mode !== "read" &&
    value.mode !== "edit" &&
    value.mode !== "yolo"
  ) {
    throw new Error(
      `Workflow "${fieldName}" mode must be "read", "edit", or "yolo".`
    );
  }

  return {
    prompt: value.prompt,
    ...(value.participant ? { participant: value.participant } : {}),
    ...(value.mode ? { mode: value.mode } : {})
  };
}

function parseWorkflowStage(value: unknown, index: number): WorkflowStage {
  if (!isRecord(value)) {
    throw new Error(`Workflow stage at index ${index} must be an object.`);
  }

  if (typeof value.id !== "string" || value.id.length === 0) {
    throw new Error(`Workflow stage at index ${index} must define a non-empty id.`);
  }

  if (typeof value.participant !== "string" || value.participant.length === 0) {
    throw new Error(
      `Workflow stage "${value.id}" must define a non-empty participant.`
    );
  }

  if (value.prompt !== undefined && typeof value.prompt !== "string") {
    throw new Error(`Workflow stage "${value.id}" prompt must be a string.`);
  }

  if (
    value.mode !== undefined &&
    value.mode !== "read" &&
    value.mode !== "edit" &&
    value.mode !== "yolo"
  ) {
    throw new Error(
      `Workflow stage "${value.id}" mode must be "read", "edit", or "yolo".`
    );
  }

  if (
    value.onFailure !== undefined &&
    value.onFailure !== "stop" &&
    value.onFailure !== "continue"
  ) {
    throw new Error(
      `Workflow stage "${value.id}" onFailure must be "stop" or "continue".`
    );
  }

  return {
    id: value.id,
    participant: value.participant,
    ...(value.prompt !== undefined ? { prompt: value.prompt } : {}),
    ...(value.mode !== undefined ? { mode: value.mode } : {}),
    ...(value.onFailure !== undefined ? { onFailure: value.onFailure } : {})
  };
}

function parseParticipants(value: unknown): Record<string, WorkflowParticipant> {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isRecord(value)) {
    throw new Error('Workflow "participants" must be an object.');
  }

  const participants: Record<string, WorkflowParticipant> = {};
  for (const [participantId, participantConfig] of Object.entries(value)) {
    participants[participantId] = normalizeParticipantConfig(
      participantId,
      participantConfig
    );
  }

  return participants;
}

function parseStages(value: unknown): WorkflowStage[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error('Workflow "stages" must be an array.');
  }

  return value.map((stage, index) => parseWorkflowStage(stage, index));
}

function parseMaxIterations(value: unknown): number {
  if (value === undefined) {
    return 1;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error('Workflow "max_iterations" must be a non-negative integer.');
  }

  return value;
}

function parseWorkflowDocument(frontmatter: unknown): ParsedWorkflowDocument {
  if (!isRecord(frontmatter)) {
    return {
      participants: {},
      stages: [],
      maxIterations: 1
    };
  }

  return {
    participants: parseParticipants(frontmatter.participants),
    setup: parseWorkflowHook(frontmatter.setup, "setup"),
    teardown: parseWorkflowHook(frontmatter.teardown, "teardown"),
    stages: parseStages(frontmatter.stages),
    maxIterations: parseMaxIterations(frontmatter.max_iterations)
  };
}

function mergeErrors(primary: unknown, secondary: unknown): unknown {
  if (primary === undefined) {
    return secondary;
  }

  return new AggregateError(
    [primary, secondary],
    "Workflow execution and teardown both failed."
  );
}

export async function runDocumentWorkflow(
  options: DocumentWorkflowOptions
): Promise<void> {
  const content = await options.fs.readFile(options.docPath, "utf8");
  const { frontmatter } = options.readConfig(content);
  const workflow = parseWorkflowDocument(frontmatter);
  const releaseLock = await lockWorkflow(options.docPath, { fs: options.fs });

  let pendingError: unknown;

  try {
    throwIfAborted(options.signal);

    if (workflow.setup) {
      await runWorkflowHook(workflow.setup, {
        cwd: options.cwd,
        participants: workflow.participants,
        runAgent: options.runAgent,
        ...(options.signal ? { signal: options.signal } : {})
      });
    }

    if (workflow.maxIterations === 0 || workflow.stages.length === 0) {
      await options.onIterationStart?.(0);
      await options.onIterationEnd?.(0, "nothing_to_run");
      return;
    }

    let shouldStop = false;

    for (let iteration = 0; iteration < workflow.maxIterations; iteration += 1) {
      throwIfAborted(options.signal);
      await options.onIterationStart?.(iteration);

      let iterationResult: IterationResult = "completed";

      for (const stage of workflow.stages) {
        throwIfAborted(options.signal);

        try {
          const stageResult = await runWorkflowStage(stage, {
            cwd: options.cwd,
            participants: workflow.participants,
            runAgent: options.runAgent,
            iteration,
            ...(options.signal ? { signal: options.signal } : {})
          });

          if (!stageResult.success) {
            iterationResult = "failed";
          }
        } catch (error) {
          if (stage.onFailure === "stop") {
            iterationResult = "failed";
            shouldStop = true;
            break;
          }

          throw error;
        }
      }

      await options.onIterationEnd?.(iteration, iterationResult);

      if (shouldStop) {
        break;
      }
    }
  } catch (error) {
    pendingError = error;
  } finally {
    try {
      if (workflow.teardown) {
        await runWorkflowHook(workflow.teardown, {
          cwd: options.cwd,
          participants: workflow.participants,
          runAgent: options.runAgent,
          ...(options.signal ? { signal: options.signal } : {})
        });
      }
    } catch (error) {
      pendingError = mergeErrors(pendingError, error);
    } finally {
      await releaseLock();
    }
  }

  if (pendingError !== undefined) {
    throw pendingError;
  }
}
