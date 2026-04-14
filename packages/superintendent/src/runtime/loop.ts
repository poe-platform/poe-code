import * as fsPromises from "node:fs/promises";
import { lockWorkflow, resolveWorkflowPath } from "@poe-code/agent-kit";
import { spawn, type McpSpawnConfig } from "@poe-code/agent-spawn";
import { parseSuperintendentDoc, type SuperintendentDoc } from "../document/parse.js";
import { parseTaskBoard } from "../document/tasks.js";
import { updateStatus } from "../document/write.js";
import { createLoopState, type LoopState } from "../state/machine.js";
import { runBuilder, type BuilderResult } from "./run-builder.js";
import { runInspector, type InspectorResult } from "./run-inspector.js";
import { runOwnerReview, type OwnerResult } from "./run-owner-review.js";
import { runSuperintendent, type SuperintendentResult } from "./run-superintendent.js";

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
    options?: { encoding?: BufferEncoding }
  ): Promise<void>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<SuperintendentFileStat>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rmdir(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
}

export interface AgentRunInput {
  agent: string;
  prompt: string;
  cwd: string;
  mode?: string;
  mcpServers?: McpSpawnConfig;
  signal?: AbortSignal;
}

export interface AgentRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  summary?: string;
  log?: string;
  output?: string;
  text?: string;
  transition?: unknown;
  toolCalls?: unknown;
  sessionResult?: unknown;
}

export type LoopCallbacks = {
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
  onLoopComplete?: (state: LoopState) => void;
  onStateChange?: (state: LoopState) => void;
  shouldPause?: () => boolean;
  shouldStop?: () => boolean;
};

export type RunLoopOptions = {
  docPath: string;
  cwd: string;
  homeDir: string;
  fs?: SuperintendentFileSystem;
  callbacks?: LoopCallbacks;
  runAgent?: (input: AgentRunInput) => Promise<AgentRunResult>;
  signal?: AbortSignal;
};

type LoopRuntime = {
  docPath: string;
  cwd: string;
  homeDir: string;
  fs: SuperintendentFileSystem;
  callbacks: LoopCallbacks;
  runAgent?: (input: AgentRunInput) => Promise<AgentRunResult>;
  signal?: AbortSignal;
};

type TemplateLoopContext = {
  builder?: BuilderResult;
  inspectors: Record<string, string>;
  superintendentSummary?: string;
  ownerFeedback?: string;
};

type AutonomousOptions = {
  cwd?: string;
  prompt: string;
  mode?: string;
  mcpServers?: McpSpawnConfig;
};

type SpawnWithAutonomous = typeof spawn & {
  autonomous?: (agent: string, options: AutonomousOptions) => Promise<unknown>;
};

export async function runLoop(docPath: string, callbacks?: LoopCallbacks): Promise<LoopState>;
export async function runLoop(options: RunLoopOptions): Promise<LoopState>;
export async function runLoop(
  input: string | RunLoopOptions,
  callbacks?: LoopCallbacks
): Promise<LoopState> {
  const options = normalizeOptions(input, callbacks);
  const releaseLock = await lockWorkflow(options.docPath, { fs: options.fs });

  try {
    return await withInjectedAgentRunner(options, async () => {
      let doc = await readDocument(options.fs, options.docPath);
      let state = createLoopState(doc);
      let context: TemplateLoopContext = {
        inspectors: {}
      };

      while (true) {
        if (shouldHalt(options) || isCompletedOrCapped(state)) {
          return finishLoop(options.callbacks, state);
        }

        if (state.state === "in_progress") {
          const roundSnapshot = await readDocumentContent(options.fs, options.docPath);
          state = beginRound(state);
          emitStateChange(options.callbacks, state);
          doc = await writeLoopState(options.fs, options.docPath, state);

          options.callbacks.onBuilderStart?.();

          let builderResult: BuilderResult;
          try {
            builderResult = await runBuilder(doc, createTemplateContext(context));
          } catch (error) {
            await restoreDocument(options.fs, options.docPath, roundSnapshot);
            const normalizedError = toError(error);
            options.callbacks.onBuilderFailed?.(normalizedError);
            throw normalizedError;
          }

          options.callbacks.onBuilderComplete?.(builderResult);
          context = {
            ...context,
            builder: builderResult,
            inspectors: {}
          };
          doc = await writeLoopState(options.fs, options.docPath, state);

          if (shouldHalt(options)) {
            return finishLoop(options.callbacks, state);
          }

          for (const [name, config] of Object.entries(doc.frontmatter.inspectors ?? {})) {
            options.callbacks.onInspectorStart?.(name);
            const inspectorSnapshot = await readDocumentContent(options.fs, options.docPath);

            let inspectorResult: InspectorResult;
            try {
              inspectorResult = await runInspector(name, config, doc, createTemplateContext(context));
            } catch (error) {
              await restoreDocument(options.fs, options.docPath, inspectorSnapshot);
              const normalizedError = toError(error);
              options.callbacks.onInspectorFailed?.(name, normalizedError);
              throw normalizedError;
            }

            options.callbacks.onInspectorComplete?.(inspectorResult);
            context = {
              ...context,
              inspectors: {
                ...context.inspectors,
                [inspectorResult.name]: inspectorResult.summary
              }
            };
            doc = await writeLoopState(options.fs, options.docPath, state);

            if (shouldHalt(options)) {
              return finishLoop(options.callbacks, state);
            }
          }

          const superintendentResult = await executeSuperintendent(options, doc, context);
          context = {
            ...context,
            superintendentSummary: superintendentResult.summary
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

          doc = await writeLoopState(options.fs, options.docPath, state);

          if (state.state === "in_progress") {
            options.callbacks.onRoundComplete?.(state.round);
          }

          if (shouldHalt(options)) {
            return finishLoop(options.callbacks, state);
          }

          continue;
        }

        if (context.ownerFeedback && shouldContinueReview(doc)) {
          const superintendentResult = await executeSuperintendent(options, doc, context);

          if (superintendentResult.transition?.action !== "request_review") {
            throw new Error("Superintendent must call request_review to continue a review exchange");
          }

          context = {
            ...context,
            superintendentSummary: superintendentResult.summary,
            ownerFeedback: undefined
          };
          doc = await writeLoopState(options.fs, options.docPath, state);

          if (shouldHalt(options)) {
            return finishLoop(options.callbacks, state);
          }

          continue;
        }

        options.callbacks.onOwnerStart?.();
        const ownerSnapshot = await readDocumentContent(options.fs, options.docPath);
        let ownerResult: OwnerResult;
        try {
          ownerResult = await runOwnerReview(doc, createTemplateContext(context));
        } catch (error) {
          await restoreDocument(options.fs, options.docPath, ownerSnapshot);
          throw toError(error);
        }
        options.callbacks.onOwnerComplete?.(ownerResult);

        if (ownerResult.transition.action === "approve_completion") {
          state = {
            ...state,
            state: "completed"
          };
        } else {
          context = {
            ...context,
            ownerFeedback: ownerResult.transition.feedback
          };
          state = applyOwnerFeedback(state, shouldContinueReview(doc));
        }

        emitStateChange(options.callbacks, state);
        doc = await writeLoopState(options.fs, options.docPath, state);

        if (state.state !== "review") {
          options.callbacks.onRoundComplete?.(state.round);
        }

        if (shouldHalt(options)) {
          return finishLoop(options.callbacks, state);
        }
      }
    });
  } finally {
    await releaseLock();
  }
}

function normalizeOptions(input: string | RunLoopOptions, callbacks?: LoopCallbacks): LoopRuntime {
  if (typeof input !== "string") {
    return {
      docPath: resolveWorkflowPath(input.docPath, input.cwd, input.homeDir),
      cwd: input.cwd,
      homeDir: input.homeDir,
      fs: input.fs ?? createDefaultFs(),
      callbacks: input.callbacks ?? {},
      ...(input.runAgent ? { runAgent: input.runAgent } : {}),
      ...(input.signal ? { signal: input.signal } : {})
    };
  }

  const cwd = process.cwd();
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? cwd;

  return {
    docPath: resolveWorkflowPath(input, cwd, homeDir),
    cwd,
    homeDir,
    fs: createDefaultFs(),
    callbacks: callbacks ?? {}
  };
}

function createDefaultFs(): SuperintendentFileSystem {
  return {
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
    mkdir: async (filePath, options) => {
      await fsPromises.mkdir(filePath, options);
    },
    rmdir: async (filePath) => {
      await fsPromises.rmdir(filePath);
    },
    rename: async (oldPath, newPath) => {
      await fsPromises.rename(oldPath, newPath);
    }
  };
}

async function readDocument(
  fs: SuperintendentFileSystem,
  docPath: string
): Promise<SuperintendentDoc> {
  const content = await readDocumentContent(fs, docPath);
  return parseSuperintendentDoc(docPath, content);
}

async function readDocumentContent(
  fs: SuperintendentFileSystem,
  docPath: string
): Promise<string> {
  return fs.readFile(docPath, "utf8");
}

async function writeLoopState(
  fs: SuperintendentFileSystem,
  docPath: string,
  state: LoopState
): Promise<SuperintendentDoc> {
  const content = await fs.readFile(docPath, "utf8");
  const updatedContent = updateStatus(docPath, content, {
    state: state.state,
    round: state.round,
    review_turn: state.reviewTurn
  });
  await fs.writeFile(docPath, updatedContent, { encoding: "utf8" });
  return parseSuperintendentDoc(docPath, updatedContent);
}

async function restoreDocument(
  fs: SuperintendentFileSystem,
  docPath: string,
  content: string
): Promise<void> {
  await fs.writeFile(docPath, content, { encoding: "utf8" });
}

function createTemplateContext(context: TemplateLoopContext): {
  builder?: BuilderResult;
  inspectors: Record<string, string>;
  superintendent?: { summary: string };
  owner?: { feedback: string };
} {
  return {
    ...(context.builder ? { builder: context.builder } : {}),
    inspectors: { ...context.inspectors },
    ...(context.superintendentSummary
      ? { superintendent: { summary: context.superintendentSummary } }
      : {}),
    ...(context.ownerFeedback ? { owner: { feedback: context.ownerFeedback } } : {})
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
  doc: SuperintendentDoc,
  context: TemplateLoopContext
): Promise<SuperintendentResult> {
  options.callbacks.onSuperintendentStart?.();
  const snapshot = await readDocumentContent(options.fs, options.docPath);
  try {
    const result = await runSuperintendent(doc, createTemplateContext(context));
    options.callbacks.onSuperintendentComplete?.(result);
    return result;
  } catch (error) {
    await restoreDocument(options.fs, options.docPath, snapshot);
    throw toError(error);
  }
}

function shouldContinueReview(doc: SuperintendentDoc): boolean {
  return parseTaskBoard(doc.body).allDone;
}

function emitStateChange(callbacks: LoopCallbacks, state: LoopState): void {
  callbacks.onStateChange?.({ ...state });
}

function isCompletedOrCapped(state: LoopState): boolean {
  if (state.state === "completed") {
    return true;
  }

  return state.state === "in_progress" && state.round >= state.maxRounds;
}

function shouldHalt(options: Pick<LoopRuntime, "callbacks" | "signal">): boolean {
  if (options.signal?.aborted) {
    return true;
  }

  return options.callbacks.shouldStop?.() === true || options.callbacks.shouldPause?.() === true;
}

function finishLoop(callbacks: LoopCallbacks, state: LoopState): LoopState {
  const snapshot = { ...state };
  callbacks.onLoopComplete?.(snapshot);
  return snapshot;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function withInjectedAgentRunner<T>(
  options: Pick<LoopRuntime, "runAgent" | "signal">,
  operation: () => Promise<T>
): Promise<T> {
  if (!options.runAgent) {
    return operation();
  }

  const spawnApi = spawn as SpawnWithAutonomous;
  const originalAutonomous = spawnApi.autonomous;

  spawnApi.autonomous = async (agent, input) => {
    const result = await options.runAgent?.({
      agent,
      prompt: input.prompt,
      cwd: input.cwd ?? process.cwd(),
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
      ...(options.signal ? { signal: options.signal } : {})
    });

    if (!result) {
      throw new Error(`Agent \`${agent}\` returned no result.`);
    }

    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr || result.stdout || `Agent \`${agent}\` failed with exit code ${result.exitCode}`
      );
    }

    return result;
  };

  try {
    return await operation();
  } finally {
    spawnApi.autonomous = originalAutonomous;
  }
}
