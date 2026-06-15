import {
  runWorkflowHook,
  type RunAgentFn,
  type RunAgentHooks,
  type WorkflowHook
} from "./hooks.js";
import { normalizeParticipantConfig, type WorkflowParticipant } from "./participant.js";
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
  readConfig: (
    content: string
  ) => { frontmatter: any; body: string } | Promise<{ frontmatter: any; body: string }>;
  signal?: AbortSignal;
  onIterationStart?: (iteration: number) => void | Promise<void>;
  onIterationEnd?: (iteration: number, result: IterationResult) => void | Promise<void>;
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

function getOwnEntry(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function defineRecordEntry<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  });
}

function requireNonEmptyString(value: unknown, message: string): string {
  if (typeof value !== "string") {
    throw new Error(message);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(message);
  }
  return trimmed;
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

  const prompt = getOwnEntry(value, "prompt");
  const participant = getOwnEntry(value, "participant");
  const mode = getOwnEntry(value, "mode");

  const normalizedPrompt = requireNonEmptyString(
    prompt,
    `Workflow "${fieldName}" must define a non-empty prompt.`
  );

  const normalizedParticipant =
    participant === undefined
      ? undefined
      : requireNonEmptyString(
          participant,
          `Workflow "${fieldName}" participant must define a non-empty string.`
        );

  if (mode !== undefined && mode !== "read" && mode !== "edit" && mode !== "yolo") {
    throw new Error(`Workflow "${fieldName}" mode must be "read", "edit", or "yolo".`);
  }

  return {
    prompt: normalizedPrompt,
    ...(normalizedParticipant ? { participant: normalizedParticipant } : {}),
    ...(mode ? { mode } : {})
  };
}

function parseWorkflowStage(value: unknown, index: number): WorkflowStage {
  if (!isRecord(value)) {
    throw new Error(`Workflow stage at index ${index} must be an object.`);
  }

  const id = getOwnEntry(value, "id");
  const normalizedId = requireNonEmptyString(
    id,
    `Workflow stage at index ${index} must define a non-empty id.`
  );

  const participant = getOwnEntry(value, "participant");
  const normalizedParticipant = requireNonEmptyString(
    participant,
    `Workflow stage "${normalizedId}" must define a non-empty participant.`
  );

  const prompt = getOwnEntry(value, "prompt");
  if (prompt !== undefined && typeof prompt !== "string") {
    throw new Error(`Workflow stage "${normalizedId}" prompt must be a string.`);
  }
  const normalizedPrompt =
    prompt === undefined
      ? undefined
      : requireNonEmptyString(
          prompt,
          `Workflow stage "${normalizedId}" prompt must be a non-empty string when provided.`
        );

  const mode = getOwnEntry(value, "mode");
  if (mode !== undefined && mode !== "read" && mode !== "edit" && mode !== "yolo") {
    throw new Error(`Workflow stage "${normalizedId}" mode must be "read", "edit", or "yolo".`);
  }

  const onFailure = getOwnEntry(value, "onFailure");
  if (onFailure !== undefined && onFailure !== "stop" && onFailure !== "continue") {
    throw new Error(`Workflow stage "${normalizedId}" onFailure must be "stop" or "continue".`);
  }

  const skills = parseSkills(getOwnEntry(value, "skills"), `Workflow stage "${normalizedId}"`);
  const hooks = parseHooks(getOwnEntry(value, "hooks"), `Workflow stage "${normalizedId}"`);

  return {
    id: normalizedId,
    participant: normalizedParticipant,
    ...(normalizedPrompt !== undefined ? { prompt: normalizedPrompt } : {}),
    ...(mode !== undefined ? { mode } : {}),
    ...(skills !== undefined ? { skills } : {}),
    ...(hooks !== undefined ? { hooks } : {}),
    ...(onFailure !== undefined ? { onFailure } : {})
  };
}

function isSkillReference(value: string): boolean {
  const slashIndex = value.indexOf("/");
  return (
    value.length > 0 &&
    value === value.trim() &&
    (slashIndex === -1 ||
      (slashIndex > 0 &&
        slashIndex < value.length - 1 &&
        value.indexOf("/", slashIndex + 1) === -1))
  );
}

function parseSkills(value: unknown, label: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || !value.every((skill) => typeof skill === "string")) {
    throw new Error(`${label} skills must be an array of strings.`);
  }

  if (!value.every(isSkillReference)) {
    throw new Error(`${label} skills must contain skill references.`);
  }

  return value;
}

function parseHooks(value: unknown, label: string): RunAgentHooks | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`${label} hooks must be an object.`);
  }
  const from = getOwnEntry(value, "from");
  const normalizedFrom = requireNonEmptyString(
    from,
    `${label} hooks from must be a non-empty string.`
  );
  const strategy = getOwnEntry(value, "strategy");
  if (
    strategy !== undefined &&
    strategy !== "auto" &&
    strategy !== "symlink" &&
    strategy !== "transform"
  ) {
    throw new Error(`${label} hooks strategy must be "auto", "symlink", or "transform".`);
  }
  const scope = getOwnEntry(value, "scope");
  if (scope !== undefined && scope !== "project" && scope !== "user" && scope !== "merged") {
    throw new Error(`${label} hooks scope must be "project", "user", or "merged".`);
  }
  return {
    from: normalizedFrom,
    ...(strategy !== undefined ? { strategy } : {}),
    ...(scope !== undefined ? { scope } : {})
  };
}

function parseParticipants(value: unknown): Record<string, WorkflowParticipant> {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isRecord(value)) {
    throw new Error('Workflow "participants" must be an object.');
  }

  const participants: Record<string, WorkflowParticipant> = Object.create(null);
  for (const [participantId, participantConfig] of Object.entries(value)) {
    const normalizedParticipantId = participantId.trim();
    if (normalizedParticipantId.length === 0) {
      throw new Error("Workflow participant id must be a non-empty string.");
    }
    if (Object.hasOwn(participants, normalizedParticipantId)) {
      throw new Error(`Duplicate workflow participant id: ${normalizedParticipantId}`);
    }
    defineRecordEntry(
      participants,
      normalizedParticipantId,
      normalizeParticipantConfig(normalizedParticipantId, participantConfig)
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
    participants: parseParticipants(getOwnEntry(frontmatter, "participants")),
    setup: parseWorkflowHook(getOwnEntry(frontmatter, "setup"), "setup"),
    teardown: parseWorkflowHook(getOwnEntry(frontmatter, "teardown"), "teardown"),
    stages: parseStages(getOwnEntry(frontmatter, "stages")),
    maxIterations: parseMaxIterations(getOwnEntry(frontmatter, "max_iterations"))
  };
}

function mergeErrors(primary: unknown, secondary: unknown): unknown {
  if (primary === undefined) {
    return secondary;
  }

  return new AggregateError([primary, secondary], "Workflow execution and teardown both failed.");
}

export async function runDocumentWorkflow(options: DocumentWorkflowOptions): Promise<void> {
  const readWorkflow = async (): Promise<ParsedWorkflowDocument> => {
    const content = await options.fs.readFile(options.docPath, "utf8");
    const { frontmatter } = await options.readConfig(content);
    return parseWorkflowDocument(frontmatter);
  };

  const initialWorkflow = await readWorkflow();
  let pendingError: unknown;
  let currentWorkflow = initialWorkflow;

  try {
    throwIfAborted(options.signal);

    if (initialWorkflow.setup) {
      await runWorkflowHook(initialWorkflow.setup, {
        cwd: options.cwd,
        participants: initialWorkflow.participants,
        runAgent: options.runAgent,
        ...(options.signal ? { signal: options.signal } : {})
      });
    }

    if (initialWorkflow.maxIterations === 0 || initialWorkflow.stages.length === 0) {
      await options.onIterationStart?.(0);
      await options.onIterationEnd?.(0, "nothing_to_run");
      return;
    }

    let shouldStop = false;

    for (let iteration = 0; iteration < initialWorkflow.maxIterations; iteration += 1) {
      throwIfAborted(options.signal);

      currentWorkflow = iteration === 0 ? initialWorkflow : await readWorkflow();

      if (iteration >= currentWorkflow.maxIterations) {
        break;
      }

      await options.onIterationStart?.(iteration);

      let iterationResult: IterationResult =
        currentWorkflow.stages.length === 0 ? "nothing_to_run" : "completed";

      for (const stage of currentWorkflow.stages) {
        throwIfAborted(options.signal);

        try {
          const stageResult = await runWorkflowStage(stage, {
            cwd: options.cwd,
            participants: currentWorkflow.participants,
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

      throwIfAborted(options.signal);
      await options.onIterationEnd?.(iteration, iterationResult);

      if (shouldStop) {
        break;
      }
    }
  } catch (error) {
    pendingError = error;
  } finally {
    try {
      if (currentWorkflow.teardown) {
        await runWorkflowHook(currentWorkflow.teardown, {
          cwd: options.cwd,
          participants: currentWorkflow.participants,
          runAgent: options.runAgent,
          ...(options.signal && !options.signal.aborted ? { signal: options.signal } : {})
        });
      }
    } catch (error) {
      pendingError = mergeErrors(pendingError, error);
    }
  }

  if (pendingError !== undefined) {
    throw pendingError;
  }
}
