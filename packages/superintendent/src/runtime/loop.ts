import path from "node:path";
import * as fsPromises from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { makeRunLogFileName, resolveWorkflowPath } from "@poe-code/agent-harness-tools";
import {
  resolveSuperintendentDoc,
  type SuperintendentDoc
} from "../document/parse.js";
import { parseTaskBoard } from "../document/tasks.js";
import { updateStatus } from "../document/write.js";
import { createLoopState, type LoopState } from "../state/machine.js";
import { withAutonomousAgentRunner, type McpSpawnConfig } from "./agent-runner.js";
import { runBuilder, type BuilderResult } from "./run-builder.js";
import { runInspector, type InspectorResult } from "./run-inspector.js";
import { runOwnerReview, type OwnerResult } from "./run-owner-review.js";
import { runSuperintendent, type SuperintendentResult } from "./run-superintendent.js";
import { collectReferencedInspectors } from "./templates.js";
import { hasOwnErrorCode } from "../error-codes.js";

export type SuperintendentStopReason =
  | "completed"
  | "dry_run"
  | "max_rounds"
  | "paused"
  | "stopped"
  | "aborted";

export type SuperintendentRunResult = LoopState & {
  stopReason: SuperintendentStopReason;
};

export interface SuperintendentFileStat {
  isFile(): boolean;
  isDirectory(): boolean;
  mtimeMs: number;
}

export interface SuperintendentFileSystem {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(
    path: string,
    data: string,
    options?: { encoding?: BufferEncoding; flag?: string }
  ): Promise<void>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<SuperintendentFileStat>;
  lstat(path: string): Promise<{ isSymbolicLink(): boolean }>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rmdir(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  unlink?(path: string): Promise<void>;
}

export interface AgentRunInput {
  agent: string;
  prompt: string;
  cwd: string;
  mode?: string;
  mcpServers?: McpSpawnConfig;
  runtime?: "host" | "docker";
  runtimeImage?: string;
  detach?: boolean;
  mountPoeCode?: boolean;
  runnerSync?: "both" | "upload" | "none";
  signal?: AbortSignal;
  logPath?: string;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface AgentRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  summary?: string;
  log?: string;
  logFile?: string;
  output?: string;
  text?: string;
  transition?: unknown;
  toolCalls?: unknown;
  sessionResult?: unknown;
}

export type LoopCallbacks = {
  runRole?: <T>(
    role: "builder" | "inspector" | "superintendent" | "owner",
    name: string | undefined,
    run: () => Promise<T>
  ) => Promise<T>;
  onBuilderStart?: () => void;
  onBuilderComplete?: (result: BuilderResult) => void;
  onBuilderFailed?: (error: Error) => void;
  onInspectorStart?: (name: string) => void;
  onInspectorComplete?: (result: InspectorResult) => void;
  onInspectorFailed?: (name: string, error: Error) => void;
  onSuperintendentStart?: () => void;
  onSuperintendentComplete?: (result: SuperintendentResult) => void;
  onOwnerStart?: () => void;
  onOwnerComplete?: (result: OwnerResult) => void;
  onRoundComplete?: (round: number) => void;
  onLoopComplete?: (state: SuperintendentRunResult) => void;
  onStateChange?: (state: LoopState) => void;
  shouldPause?: () => boolean;
  shouldStop?: () => boolean;
};

export type LoopRunners = {
  builder?: typeof runBuilder;
  inspector?: typeof runInspector;
  superintendent?: typeof runSuperintendent;
  ownerReview?: typeof runOwnerReview;
};

export type RunLoopOptions = {
  docPath: string;
  cwd: string;
  homeDir: string;
  fs?: SuperintendentFileSystem;
  callbacks?: LoopCallbacks;
  runAgent?: (input: AgentRunInput) => Promise<AgentRunResult>;
  builderAgent?: string;
  runners?: LoopRunners;
  signal?: AbortSignal;
  logDir?: string;
};

type ResolvedRunners = {
  builder: typeof runBuilder;
  inspector: typeof runInspector;
  superintendent: typeof runSuperintendent;
  ownerReview: typeof runOwnerReview;
};

type LoopRuntime = {
  docPath: string;
  cwd: string;
  homeDir: string;
  fs: SuperintendentFileSystem;
  callbacks: LoopCallbacks;
  runAgent?: (input: AgentRunInput) => Promise<AgentRunResult>;
  builderAgent?: string;
  runners: ResolvedRunners;
  signal?: AbortSignal;
  logDir?: string;
};

type TemplateLoopContext = {
  builder?: BuilderResult;
  inspectors: Record<string, string>;
  inspectorLogs: Record<string, string>;
  superintendentSummary?: string;
  superintendentLogPath?: string;
  ownerFeedback?: string;
  ownerLogPath?: string;
};

export async function runLoop(
  docPath: string,
  callbacks?: LoopCallbacks
): Promise<SuperintendentRunResult>;
export async function runLoop(options: RunLoopOptions): Promise<SuperintendentRunResult>;
export async function runLoop(
  input: string | RunLoopOptions,
  callbacks?: LoopCallbacks
): Promise<SuperintendentRunResult> {
  const options = normalizeOptions(input, callbacks);
  return withInjectedAgentRunner(options, async () => {
    let state = createLoopState(await readDocument(options.fs, options.docPath));
    let context: TemplateLoopContext = {
      inspectors: {},
      inspectorLogs: {}
    };

    while (true) {
      const stopReason = readLoopStopReason(options, state);

      if (stopReason) {
        return finishLoop(options.callbacks, state, stopReason);
      }

      if (state.state === "in_progress") {
        const roundStartState = { ...state };
        const roundSnapshot = await readDocumentContent(options.fs, options.docPath);
        state = beginRound(state);
        emitStateChange(options.callbacks, state);
        await writeLoopState(options.fs, options.docPath, state);

        options.callbacks.onBuilderStart?.();

        let builderResult: BuilderResult;
        try {
          const builderDoc = await readDocument(options.fs, options.docPath);
          builderResult = await runRole(options, "builder", undefined, () =>
            options.runners.builder(
              options.builderAgent
                ? {
                    ...builderDoc,
                    frontmatter: {
                      ...builderDoc.frontmatter,
                      builder: { ...builderDoc.frontmatter.builder, agent: options.builderAgent }
                    }
                  }
                : builderDoc,
              createTemplateContext(context),
              buildRoleOptions(options, "builder")
            )
          );
        } catch (error) {
          const normalizedError = await preserveFailedRoleDocument(
            options.fs,
            options.docPath,
            roundSnapshot,
            error
          );
          options.callbacks.onBuilderFailed?.(normalizedError);
          throw normalizedError;
        }

        options.callbacks.onBuilderComplete?.(builderResult);
        context = {
          ...context,
          builder: builderResult,
          inspectors: {},
          inspectorLogs: {}
        };
        await writeLoopState(options.fs, options.docPath, state);

        const stopReason = readInterruptionReason(options, state);

        if (stopReason) {
          if (stopReason === "aborted") {
            state = await rollbackRoundStatus(options, roundStartState);
          }
          return finishLoop(options.callbacks, state, stopReason);
        }

        const docForInspectors = await readDocument(options.fs, options.docPath);
        const inspectorEntries = filterAutoRunInspectors(docForInspectors);

        for (const [name, config] of inspectorEntries) {
          options.callbacks.onInspectorStart?.(name);
          const inspectorSnapshot = await readDocumentContent(options.fs, options.docPath);

          let inspectorResult: InspectorResult;
          try {
            inspectorResult = await runRole(options, "inspector", name, async () =>
              options.runners.inspector(
                name,
                config,
                await readDocument(options.fs, options.docPath),
                createTemplateContext(context),
                buildRoleOptions(options, `inspector-${name}`)
              )
            );
          } catch (error) {
            const normalizedError = await preserveFailedRoleDocument(
              options.fs,
              options.docPath,
              inspectorSnapshot,
              error
            );
            options.callbacks.onInspectorFailed?.(name, normalizedError);
            throw normalizedError;
          }

          options.callbacks.onInspectorComplete?.(inspectorResult);
          context = {
            ...context,
            inspectors: {
              ...context.inspectors,
              [inspectorResult.name]: inspectorResult.summary
            },
            inspectorLogs: {
              ...context.inspectorLogs,
              ...(inspectorResult.log_path
                ? { [inspectorResult.name]: inspectorResult.log_path }
                : {})
            }
          };
          await writeLoopState(options.fs, options.docPath, state);

          const stopReason = readInterruptionReason(options, state);

          if (stopReason) {
            if (stopReason === "aborted") {
              state = await rollbackRoundStatus(options, roundStartState);
            }
            return finishLoop(options.callbacks, state, stopReason);
          }
        }

        const superintendentResult = await executeSuperintendent(options, context);
        context = {
          ...context,
          superintendentSummary: superintendentResult.summary,
          ...(superintendentResult.log_path
            ? { superintendentLogPath: superintendentResult.log_path }
            : {})
        };

        if (superintendentResult.transition?.action === "request_review") {
          context = {
            ...context,
            ownerFeedback: undefined
          };
          state = {
            ...state,
            state: "review",
            reviewTurn: 0
          };
          emitStateChange(options.callbacks, state);
        }

        await writeLoopState(options.fs, options.docPath, state);

        if (state.state === "in_progress") {
          options.callbacks.onRoundComplete?.(state.round);
        }

        {
          const stopReason = readLoopStopReason(options, state);

          if (stopReason) {
            if (stopReason === "aborted" && state.state === "in_progress") {
              state = await rollbackRoundStatus(options, roundStartState);
            }
            return finishLoop(options.callbacks, state, stopReason);
          }
        }

        continue;
      }

      if (
        context.ownerFeedback &&
        shouldContinueReview(await readDocument(options.fs, options.docPath))
      ) {
        const superintendentResult = await executeSuperintendent(options, context);

        if (superintendentResult.transition?.action !== "request_review") {
          throw new Error("Superintendent must call request_review to continue a review exchange");
        }

        context = {
          ...context,
          superintendentSummary: superintendentResult.summary,
          ...(superintendentResult.log_path
            ? { superintendentLogPath: superintendentResult.log_path }
            : {}),
          ownerFeedback: undefined
        };
        await writeLoopState(options.fs, options.docPath, state);

        {
          const stopReason = readInterruptionReason(options, state);

          if (stopReason) {
            return finishLoop(options.callbacks, state, stopReason);
          }
        }

        continue;
      }

      options.callbacks.onOwnerStart?.();
      const ownerSnapshot = await readDocumentContent(options.fs, options.docPath);
      let ownerResult: OwnerResult;
      try {
        ownerResult = await runRole(options, "owner", undefined, async () =>
          options.runners.ownerReview(
            await readDocument(options.fs, options.docPath),
            createTemplateContext(context),
            buildRoleOptions(options, "owner")
          )
        );
      } catch (error) {
        throw await preserveFailedRoleDocument(options.fs, options.docPath, ownerSnapshot, error);
      }
      options.callbacks.onOwnerComplete?.(ownerResult);

      {
        const stopReason = readInterruptionReason(options, state);

        if (stopReason) {
          return finishLoop(options.callbacks, state, stopReason);
        }
      }

      if (ownerResult.transition.action === "approve_completion") {
        context = {
          ...context,
          ...(ownerResult.log_path ? { ownerLogPath: ownerResult.log_path } : {})
        };
        state = {
          ...state,
          state: "completed"
        };
      } else {
        context = {
          ...context,
          ownerFeedback: ownerResult.transition.feedback,
          ...(ownerResult.log_path ? { ownerLogPath: ownerResult.log_path } : {})
        };
        state = applyOwnerFeedback(
          state,
          shouldContinueReview(await readDocument(options.fs, options.docPath))
        );
      }

      emitStateChange(options.callbacks, state);
      await writeLoopState(options.fs, options.docPath, state);

      if (state.state !== "review") {
        options.callbacks.onRoundComplete?.(state.round);
      }

      {
        const stopReason = readLoopStopReason(options, state);

        if (stopReason) {
          return finishLoop(options.callbacks, state, stopReason);
        }
      }
    }
  });
}

function normalizeOptions(input: string | RunLoopOptions, callbacks?: LoopCallbacks): LoopRuntime {
  if (typeof input !== "string") {
    return {
      docPath: resolveWorkflowPath(input.docPath, input.cwd, input.homeDir),
      cwd: input.cwd,
      homeDir: input.homeDir,
      fs: input.fs ?? createDefaultFs(),
      callbacks: input.callbacks ?? {},
      runners: resolveRunners(input.runners),
      ...(input.runAgent ? { runAgent: input.runAgent } : {}),
      ...(input.builderAgent ? { builderAgent: input.builderAgent } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.logDir ? { logDir: input.logDir } : {})
    };
  }

  const cwd = process.cwd();
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? cwd;

  return {
    docPath: resolveWorkflowPath(input, cwd, homeDir),
    cwd,
    homeDir,
    fs: createDefaultFs(),
    callbacks: callbacks ?? {},
    runners: resolveRunners()
  };
}

function resolveRunners(overrides?: LoopRunners): ResolvedRunners {
  return {
    builder: overrides?.builder ?? runBuilder,
    inspector: overrides?.inspector ?? runInspector,
    superintendent: overrides?.superintendent ?? runSuperintendent,
    ownerReview: overrides?.ownerReview ?? runOwnerReview
  };
}

function createDefaultFs(): SuperintendentFileSystem {
  const fs = {
    readFile: fsPromises.readFile as SuperintendentFileSystem["readFile"],
    writeFile: fsPromises.writeFile as SuperintendentFileSystem["writeFile"],
    readdir: fsPromises.readdir,
    stat: async (filePath: string) => {
      const stat = await fsPromises.stat(filePath);
      return {
        isFile: () => stat.isFile(),
        isDirectory: () => stat.isDirectory(),
        mtimeMs: stat.mtimeMs
      };
    },
    lstat: async (filePath: string) => {
      const stat = await fsPromises.lstat(filePath);
      return { isSymbolicLink: () => stat.isSymbolicLink() };
    },
    mkdir: async (filePath: string, options?: { recursive?: boolean }) => {
      await fsPromises.mkdir(filePath, options);
    },
    rmdir: async (filePath: string) => {
      await fsPromises.rmdir(filePath);
    },
    rename: async (oldPath: string, newPath: string) => {
      await fsPromises.rename(oldPath, newPath);
    },
    unlink: async (filePath: string) => {
      await fsPromises.unlink(filePath);
    }
  };

  return fs as SuperintendentFileSystem;
}

async function readDocument(
  fs: SuperintendentFileSystem,
  docPath: string
): Promise<SuperintendentDoc> {
  const content = await readDocumentContent(fs, docPath);
  return (await resolveSuperintendentDoc(docPath, content, fs)).document;
}

async function readDocumentContent(fs: SuperintendentFileSystem, docPath: string): Promise<string> {
  return fs.readFile(docPath, "utf8");
}

async function writeLoopState(
  fs: SuperintendentFileSystem,
  docPath: string,
  state: LoopState
): Promise<void> {
  const content = await fs.readFile(docPath, "utf8");
  const updatedContent = updateStatus(docPath, content, {
    state: state.state,
    round: state.round,
    review_turn: state.reviewTurn
  });
  await writeDocumentContent(fs, docPath, updatedContent);
}

async function preserveFailedRoleDocument(
  fs: SuperintendentFileSystem,
  docPath: string,
  content: string,
  error: unknown
): Promise<Error> {
  const failure = toError(error);
  const recoveryPath = `${docPath}.recovery-${randomUUID()}.bak`;
  try {
    await fs.writeFile(recoveryPath, content, { encoding: "utf8", flag: "wx" });
  } catch (recoveryError) {
    return new Error(
      `${failure.message}\nDocument was not rolled back.\nCould not save the pre-role snapshot:\n${recoveryPath}\nSnapshot error: ${toError(recoveryError).message}`,
      { cause: failure }
    );
  }
  return new Error(
    `${failure.message}\nDocument was not rolled back.\nPre-role snapshot saved to:\n${recoveryPath}\nCompare it with the current document before resuming.`,
    { cause: failure }
  );
}

async function writeDocumentContent(
  fs: SuperintendentFileSystem,
  docPath: string,
  content: string
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const tempPath = createDocumentTempPath(docPath);
    let tempCreated = false;
    try {
      await fs.writeFile(tempPath, content, { encoding: "utf8", flag: "wx" });
      tempCreated = true;
      await fs.rename(tempPath, docPath);
      tempCreated = false;
      return;
    } catch (error) {
      const alreadyExists = isAlreadyExists(error);
      if (alreadyExists && !tempCreated) {
        continue;
      }
      if (tempCreated || !alreadyExists) {
        await fs.unlink?.(tempPath).catch(() => undefined);
      }
      throw error;
    }
  }

  throw new Error(`Unable to create temporary superintendent document for ${docPath}.`);
}

function createDocumentTempPath(docPath: string): string {
  return path.join(
    path.dirname(docPath),
    `.${path.basename(docPath)}.${process.pid}.${randomUUID()}.tmp`
  );
}

function isAlreadyExists(error: unknown): boolean {
  return hasOwnErrorCode(error, "EEXIST");
}

async function rollbackRoundStatus(
  options: Pick<LoopRuntime, "callbacks" | "docPath" | "fs">,
  state: LoopState
): Promise<LoopState> {
  await writeLoopState(options.fs, options.docPath, state);
  emitStateChange(options.callbacks, state);
  return state;
}

function createTemplateContext(context: TemplateLoopContext): {
  builder?: BuilderResult;
  inspectors: Record<string, string>;
  inspector_logs: Record<string, string>;
  superintendent?: { summary: string; log_path?: string };
  owner?: { feedback: string; log_path?: string };
} {
  return {
    ...(context.builder ? { builder: context.builder } : {}),
    inspectors: { ...context.inspectors },
    inspector_logs: { ...context.inspectorLogs },
    ...(context.superintendentSummary
      ? {
          superintendent: {
            summary: context.superintendentSummary,
            ...(context.superintendentLogPath ? { log_path: context.superintendentLogPath } : {})
          }
        }
      : {}),
    ...(context.ownerFeedback
      ? {
          owner: {
            feedback: context.ownerFeedback,
            ...(context.ownerLogPath ? { log_path: context.ownerLogPath } : {})
          }
        }
      : {})
  };
}

function beginRound(state: LoopState): LoopState {
  return {
    ...state,
    state: "in_progress",
    round: state.round + 1,
    reviewTurn: 0
  };
}

function applyOwnerFeedback(state: LoopState, continueReview: boolean): LoopState {
  const nextReviewTurn = state.reviewTurn + 1;

  if (continueReview && nextReviewTurn < state.maxReviewTurns) {
    return {
      ...state,
      state: "review",
      reviewTurn: nextReviewTurn
    };
  }

  return {
    ...state,
    state: "in_progress",
    reviewTurn: 0
  };
}

async function executeSuperintendent(
  options: LoopRuntime,
  context: TemplateLoopContext
): Promise<SuperintendentResult> {
  options.callbacks.onSuperintendentStart?.();
  const snapshot = await readDocumentContent(options.fs, options.docPath);
  try {
    const doc = await readDocument(options.fs, options.docPath);
    const result = await runRole(options, "superintendent", undefined, () =>
      options.runners.superintendent(
        doc,
        createTemplateContext(context),
        buildRoleOptions(options, "superintendent")
      )
    );
    options.callbacks.onSuperintendentComplete?.(result);
    return result;
  } catch (error) {
    throw await preserveFailedRoleDocument(options.fs, options.docPath, snapshot, error);
  }
}

function runRole<T>(
  options: LoopRuntime,
  role: "builder" | "inspector" | "superintendent" | "owner",
  name: string | undefined,
  run: () => Promise<T>
): Promise<T> {
  return options.callbacks.runRole?.(role, name, run) ?? run();
}

function buildRoleOptions(
  options: LoopRuntime,
  role: string
): { defaultCwd: string; logPath?: string; signal?: AbortSignal } {
  return {
    defaultCwd: options.cwd,
    ...(options.logDir ? { logPath: path.join(options.logDir, makeRunLogFileName(role)) } : {}),
    ...(options.signal ? { signal: options.signal } : {})
  };
}

function shouldContinueReview(doc: SuperintendentDoc): boolean {
  return parseTaskBoard(doc.body).allDone;
}

function emitStateChange(callbacks: LoopCallbacks, state: LoopState): void {
  callbacks.onStateChange?.({ ...state });
}

function readLoopStopReason(
  options: Pick<LoopRuntime, "callbacks" | "signal">,
  state: LoopState
): SuperintendentStopReason | undefined {
  if (state.state === "completed") {
    return "completed";
  }

  if (state.state === "in_progress" && state.round >= state.maxRounds) {
    return "max_rounds";
  }

  return readInterruptionReason(options, state);
}

function readInterruptionReason(
  options: Pick<LoopRuntime, "callbacks" | "signal">,
  _state: LoopState
): SuperintendentStopReason | undefined {
  if (options.signal?.aborted) {
    return "aborted";
  }

  if (options.callbacks.shouldStop?.() === true) {
    return "stopped";
  }

  if (options.callbacks.shouldPause?.() === true) {
    return "paused";
  }

  return undefined;
}

function finishLoop(
  callbacks: LoopCallbacks,
  state: LoopState,
  stopReason: SuperintendentStopReason
): SuperintendentRunResult {
  const snapshot = {
    ...state,
    stopReason
  };
  callbacks.onLoopComplete?.(snapshot);
  return snapshot;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function filterAutoRunInspectors(
  doc: SuperintendentDoc
): Array<[string, NonNullable<SuperintendentDoc["frontmatter"]["inspectors"]>[string]]> {
  const inspectors = doc.frontmatter.inspectors ?? {};
  const configuredNames = new Set(Object.keys(inspectors));
  const selected = new Set<string>();
  const queue = [...collectReferencedInspectors(doc.frontmatter.superintendent.prompt)].filter(
    (name) => configuredNames.has(name)
  );

  while (queue.length > 0) {
    const name = queue.shift() as string;

    if (selected.has(name)) {
      continue;
    }

    selected.add(name);
    const inspectorPrompt = inspectors[name]?.prompt ?? "";

    for (const referenced of collectReferencedInspectors(inspectorPrompt)) {
      if (configuredNames.has(referenced) && !selected.has(referenced)) {
        queue.push(referenced);
      }
    }
  }

  return Object.entries(inspectors).filter(([name]) => selected.has(name));
}

async function withInjectedAgentRunner<T>(
  options: Pick<LoopRuntime, "runAgent" | "signal">,
  operation: () => Promise<T>
): Promise<T> {
  if (!options.runAgent) {
    return operation();
  }

  return withAutonomousAgentRunner(async (agent, input) => {
    const result = await options.runAgent?.({
      agent,
      prompt: input.prompt,
      cwd: input.cwd ?? process.cwd(),
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
      ...(input.logPath ? { logPath: input.logPath } : {}),
      ...(options.signal ? { signal: options.signal } : {})
    });

    if (!result) {
      throw new Error(`Agent \`${agent}\` returned no result.`);
    }

    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr ||
          result.stdout ||
          `Agent \`${agent}\` failed with exit code ${result.exitCode}`
      );
    }

    return result;
  }, operation);
}
