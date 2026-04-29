import path from "node:path";
import os from "node:os";
import * as fsPromises from "node:fs/promises";
import { lockWorkflow, makeRunLogFileName, resolveWorkflowPath } from "@poe-code/agent-harness-tools";
import {
  makeAgentModule,
  makeEnvModule,
  makeFailModule,
  makeHarnessModule,
  makeLogModule,
  makeMcpModule,
  makeTimeModule,
  runHarness
} from "@poe-code/agent-script";
import { spawn, type McpSpawnConfig } from "@poe-code/agent-spawn";
import { McpClient, StdioTransport } from "tiny-mcp-client";
import { parseSuperintendentDoc, type SuperintendentDoc } from "../document/parse.js";
import { parseTaskBoard } from "../document/tasks.js";
import { updateStatus } from "../document/write.js";
import { createLoopState, type LoopState } from "../state/machine.js";
import { superintendentHarnessScript } from "./harness-script.js";
import { runBuilder, type BuilderResult } from "./run-builder.js";
import { runInspector, type InspectorResult } from "./run-inspector.js";
import { runOwnerReview, type OwnerResult } from "./run-owner-review.js";
import { runSuperintendent, type SuperintendentResult } from "./run-superintendent.js";
import { collectReferencedInspectors, type TemplateContext } from "./templates.js";

export type SuperintendentStopReason =
  | "completed"
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

export type SuperintendentLogEntry = Parameters<NonNullable<Parameters<typeof makeLogModule>[0]>>[0];

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
  onLoopComplete?: (state: SuperintendentRunResult) => void;
  onStateChange?: (state: LoopState) => void;
  onLogEntry?: (entry: SuperintendentLogEntry) => void;
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
  runners: ResolvedRunners;
  signal?: AbortSignal;
  logDir?: string;
};

type AutonomousOptions = {
  cwd?: string;
  prompt: string;
  mode?: string;
  mcpServers?: McpSpawnConfig;
  logPath?: string;
};

type LockCapableSuperintendentFs = {
  open(path: string, flags: string): Promise<{
    close(): Promise<void>;
    writeFile(
      data: string,
      options?: BufferEncoding | { encoding?: BufferEncoding }
    ): Promise<void>;
  }>;
  stat(path: string): Promise<{
    mtimeMs: number;
  }>;
  unlink(path: string): Promise<void>;
};

type SpawnWithAutonomous = typeof spawn & {
  autonomous?: (agent: string, options: AutonomousOptions) => Promise<unknown>;
};

type LogEntry = SuperintendentLogEntry;
type SuperintendentHarnessModules = ReturnType<Parameters<typeof runHarness>[1]["modulesFor"]>;

type LogEventChannel = {
  publish(entry: LogEntry): void;
  subscribe(listener: (entry: LogEntry) => void): () => void;
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
  const releaseLock = await lockWorkflow(options.docPath, {
    fs: options.fs as unknown as LockCapableSuperintendentFs
  });

  try {
    return await withInjectedAgentRunner(options, async () => {
      const doc = await readDocument(options.fs, options.docPath);
      const eventChannel = createLogEventChannel();
      const unsubscribe = subscribeToLoopEvents(options.callbacks, eventChannel);

      try {
        let result: Awaited<ReturnType<typeof runHarness>>;
        try {
          result = await runHarness(await ensureHarnessScriptFile(), {
            modulesFor: (): SuperintendentHarnessModules => ({
              agent: makeAgentModule(async (input) => {
                const result = options.runAgent
                  ? await options.runAgent({
                      agent: input.agent,
                      prompt: input.prompt,
                      cwd: input.cwd ?? options.cwd,
                      mode: input.mode ?? "yolo",
                      ...(input.mcp ? { mcpServers: input.mcp } : {}),
                      ...(options.signal ? { signal: options.signal } : {}),
                      ...(options.logDir ? { logPath: options.logDir } : {})
                    })
                  : await spawn(input.agent, {
                      prompt: input.prompt,
                      cwd: input.cwd ?? options.cwd,
                      mode: input.mode,
                      ...(input.mcp ? { mcpServers: input.mcp } : {}),
                      ...(options.signal ? { signal: options.signal } : {})
                    });

                return {
                  exitCode: result.exitCode,
                  stdout: result.stdout,
                  stderr: result.stderr,
                  summary: result.stdout.trim(),
                  durationMs:
                    "durationMs" in result && typeof result.durationMs === "number"
                      ? result.durationMs
                      : 0
                };
              }),
              env: makeEnvModule([]),
              fail: makeFailModule(),
              harness: makeHarnessModule(doc.frontmatter as unknown as Record<string, unknown>, {
                filepath: options.docPath,
                kind: doc.frontmatter.kind,
                version: doc.frontmatter.version
              }),
              log: makeLogModule((entry) => {
                eventChannel.publish(entry);
              }),
              mcp: makeMcpModule(async (server) => {
                const client = new McpClient({
                  clientInfo: {
                    name: "poe-code-superintendent",
                    version: "0.0.0"
                  }
                });

                await client.connect(
                  new StdioTransport({
                    command: server.command,
                    ...(server.args === undefined ? {} : { args: server.args }),
                    ...(server.env === undefined ? {} : { env: server.env })
                  })
                );

                return {
                  listTools: async () => client.listTools(),
                  callTool: async (params) =>
                    client.callTool({
                      name: params.name,
                      ...(params.arguments === undefined
                        ? {}
                        : { arguments: params.arguments as Record<string, unknown> })
                    })
                };
              }),
              superintendent: createSuperintendentModule(options, eventChannel),
              time: makeTimeModule()
            }) as SuperintendentHarnessModules
          });
        } catch (error) {
          throw toError(readErrorMessage(error));
        }

        if (result.ok !== true) {
          throw toError(readErrorMessage((result as unknown as { ok: false; error: unknown }).error));
        }

        return readRunResult((result as unknown as { ok: true; returnValue?: unknown }).returnValue);
      } finally {
        unsubscribe();
      }
    });
  } finally {
    await releaseLock();
  }
}

async function rollbackRoundStatus(
  options: Pick<LoopRuntime, "docPath" | "fs">,
  state: LoopState
): Promise<LoopState> {
  await writeLoopState(options.fs, options.docPath, state);
  return state;
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

function publishEvent(eventChannel: LogEventChannel, name: string, payload: unknown): void {
  eventChannel.publish({
    ts: new Date().toISOString(),
    type: "event",
    name,
    payload
  });
}

function emitStateChange(eventChannel: LogEventChannel, state: LoopState): void {
  publishEvent(eventChannel, "state.changed", state);
}

function finishLoop(
  eventChannel: LogEventChannel,
  state: LoopState,
  stopReason: SuperintendentStopReason
): SuperintendentRunResult {
  const snapshot = {
    ...state,
    stopReason
  };
  publishEvent(eventChannel, "loop.completed", snapshot);
  return snapshot;
}

function readLoopStopReason(
  options: Pick<LoopRuntime, "callbacks" | "signal">,
  state: LoopState,
  maxRounds: number
): SuperintendentStopReason | undefined {
  if (state.state === "completed") {
    return "completed";
  }

  if (state.state === "in_progress" && state.round >= maxRounds) {
    return "max_rounds";
  }

  return readInterruptionReason(options);
}

function readInterruptionReason(
  options: Pick<LoopRuntime, "callbacks" | "signal">
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
    open: (filePath: string, flags: string) => fsPromises.open(filePath, flags),
    stat: async (filePath: string) => {
      const stat = await fsPromises.stat(filePath);
      return {
        isFile: () => stat.isFile(),
        isDirectory: () => stat.isDirectory(),
        mtimeMs: stat.mtimeMs
      };
    },
    unlink: async (filePath: string) => {
      await fsPromises.unlink(filePath);
    },
    mkdir: async (filePath: string, options?: { recursive?: boolean }) => {
      await fsPromises.mkdir(filePath, options);
    },
    rmdir: async (filePath: string) => {
      await fsPromises.rmdir(filePath);
    },
    rename: async (oldPath: string, newPath: string) => {
      await fsPromises.rename(oldPath, newPath);
    }
  };

  return fs as SuperintendentFileSystem;
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
): Promise<void> {
  const content = await fs.readFile(docPath, "utf8");
  const updatedContent = updateStatus(docPath, content, {
    state: state.state,
    round: state.round,
    review_turn: state.reviewTurn
  });
  await fs.writeFile(docPath, updatedContent, { encoding: "utf8" });
}

async function restoreDocument(
  fs: SuperintendentFileSystem,
  docPath: string,
  content: string
): Promise<void> {
  await fs.writeFile(docPath, content, { encoding: "utf8" });
}

function createLogEventChannel(): LogEventChannel {
  const listeners = new Set<(entry: LogEntry) => void>();

  return {
    publish(entry) {
      for (const listener of listeners) {
        listener(entry);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}

function subscribeToLoopEvents(callbacks: LoopCallbacks, channel: LogEventChannel): () => void {
  return channel.subscribe((entry) => {
    callbacks.onLogEntry?.(entry);

    if (entry.type !== "event") {
      return;
    }

    switch (entry.name) {
      case "builder.started":
        callbacks.onBuilderStart?.();
        return;
      case "builder.completed":
        callbacks.onBuilderComplete?.(entry.payload as BuilderResult);
        return;
      case "builder.failed":
        callbacks.onBuilderFailed?.(toError(readErrorMessage(entry.payload)));
        return;
      case "inspector.started":
        callbacks.onInspectorStart?.(readNamedPayload(entry.payload));
        return;
      case "inspector.completed":
        callbacks.onInspectorComplete?.(entry.payload as InspectorResult);
        return;
      case "inspector.failed":
        callbacks.onInspectorFailed?.(
          readNamedPayload(entry.payload),
          toError(readErrorMessage(entry.payload))
        );
        return;
      case "superintendent.started":
        callbacks.onSuperintendentStart?.();
        return;
      case "superintendent.completed":
        callbacks.onSuperintendentComplete?.(entry.payload as SuperintendentResult);
        return;
      case "owner.started":
        callbacks.onOwnerStart?.();
        return;
      case "owner.completed":
        callbacks.onOwnerComplete?.(entry.payload as OwnerResult);
        return;
      case "round.completed":
        callbacks.onRoundComplete?.(readRoundPayload(entry.payload));
        return;
      case "state.changed":
        callbacks.onStateChange?.(readLoopStateValue(entry.payload));
        return;
      case "loop.completed":
        callbacks.onLoopComplete?.(readRunResult(entry.payload));
        return;
    }
  });
}

function createSuperintendentModule(
  options: LoopRuntime,
  eventChannel: LogEventChannel
): Record<string, (...args: unknown[]) => unknown> {
  return {
    run: async (input: unknown) =>
      executeHarnessLoop(options, eventChannel, readScriptRunOptions(input).maxRounds)
  };
}

async function executeHarnessLoop(
  options: LoopRuntime,
  eventChannel: LogEventChannel,
  scriptMaxRounds: number | undefined
): Promise<SuperintendentRunResult> {
  let state = createLoopState(await readDocument(options.fs, options.docPath));
  const maxRounds = scriptMaxRounds ?? state.maxRounds;
  let context: Partial<TemplateContext> & Pick<TemplateContext, "inspectors" | "inspector_logs"> = {
    inspectors: {},
    inspector_logs: {}
  };

  while (true) {
    const stopReason = readLoopStopReason(options, state, maxRounds);

    if (stopReason) {
      return finishLoop(eventChannel, state, stopReason);
    }

    if (state.state === "in_progress") {
      const roundStartState = { ...state };
      const roundSnapshot = await readDocumentContent(options.fs, options.docPath);
      state = {
        ...state,
        state: "in_progress",
        round: state.round + 1,
        reviewTurn: 0
      };
      emitStateChange(eventChannel, state);
      await writeLoopState(options.fs, options.docPath, state);

      publishEvent(eventChannel, "builder.started", {});

      let builderResult: BuilderResult;
      try {
        builderResult = await options.runners.builder(
          await readDocument(options.fs, options.docPath),
          readTemplateContext(context),
          buildRoleOptions(options, "builder")
        );
      } catch (error) {
        await restoreDocument(options.fs, options.docPath, roundSnapshot);
        publishEvent(eventChannel, "builder.failed", {
          message: toError(error).message
        });
        throw toError(error);
      }

      publishEvent(eventChannel, "builder.completed", builderResult);
      context = {
        ...context,
        builder: builderResult,
        inspectors: {},
        inspector_logs: {}
      };
      await writeLoopState(options.fs, options.docPath, state);

      {
        const interruption = readInterruptionReason(options);
        if (interruption) {
          if (interruption === "aborted") {
            state = await rollbackRoundStatus(options, roundStartState);
            emitStateChange(eventChannel, state);
          }
          return finishLoop(eventChannel, state, interruption);
        }
      }

      const inspectorEntries = filterAutoRunInspectors(await readDocument(options.fs, options.docPath));

      for (const [name, config] of inspectorEntries) {
        publishEvent(eventChannel, "inspector.started", { name });
        const inspectorSnapshot = await readDocumentContent(options.fs, options.docPath);

        let inspectorResult: InspectorResult;
        try {
          inspectorResult = await options.runners.inspector(
            name,
            config,
            await readDocument(options.fs, options.docPath),
            readTemplateContext(context),
            buildRoleOptions(options, `inspector-${name}`)
          );
        } catch (error) {
          await restoreDocument(options.fs, options.docPath, inspectorSnapshot);
          publishEvent(eventChannel, "inspector.failed", {
            name,
            message: toError(error).message
          });
          throw toError(error);
        }

        publishEvent(eventChannel, "inspector.completed", inspectorResult);
        context = {
          ...context,
          inspectors: {
            ...context.inspectors,
            [inspectorResult.name]: inspectorResult.summary
          },
          inspector_logs: {
            ...context.inspector_logs,
            ...(inspectorResult.log_path
              ? { [inspectorResult.name]: inspectorResult.log_path }
              : {})
          }
        };
        await writeLoopState(options.fs, options.docPath, state);

        {
          const interruption = readInterruptionReason(options);
          if (interruption) {
            if (interruption === "aborted") {
              state = await rollbackRoundStatus(options, roundStartState);
              emitStateChange(eventChannel, state);
            }
            return finishLoop(eventChannel, state, interruption);
          }
        }
      }

      publishEvent(eventChannel, "superintendent.started", {});
      const superintendentSnapshot = await readDocumentContent(options.fs, options.docPath);
      let superintendentResult: SuperintendentResult;
      try {
        superintendentResult = await options.runners.superintendent(
          await readDocument(options.fs, options.docPath),
          readTemplateContext(context),
          buildRoleOptions(options, "superintendent")
        );
      } catch (error) {
        await restoreDocument(options.fs, options.docPath, superintendentSnapshot);
        throw toError(error);
      }
      publishEvent(eventChannel, "superintendent.completed", superintendentResult);

      context = {
        ...context,
        superintendent: {
          summary: superintendentResult.summary,
          ...(superintendentResult.log_path ? { log_path: superintendentResult.log_path } : {})
        }
      };

      if (superintendentResult.transition?.action === "request_review") {
        context = {
          ...context,
          owner: undefined
        };
        state = {
          ...state,
          state: "review",
          reviewTurn: 0
        };
        emitStateChange(eventChannel, state);
      }

      await writeLoopState(options.fs, options.docPath, state);

      if (state.state === "in_progress") {
        publishEvent(eventChannel, "round.completed", { round: state.round });
      }

      {
        const stopReason = readLoopStopReason(options, state, maxRounds);

        if (stopReason) {
          if (stopReason === "aborted" && state.state === "in_progress") {
            state = await rollbackRoundStatus(options, roundStartState);
            emitStateChange(eventChannel, state);
          }
          return finishLoop(eventChannel, state, stopReason);
        }
      }

      continue;
    }

    if (context.owner?.feedback && shouldContinueReview(await readDocument(options.fs, options.docPath))) {
      publishEvent(eventChannel, "superintendent.started", {});
      const superintendentSnapshot = await readDocumentContent(options.fs, options.docPath);
      let superintendentResult: SuperintendentResult;
      try {
        superintendentResult = await options.runners.superintendent(
          await readDocument(options.fs, options.docPath),
          readTemplateContext(context),
          buildRoleOptions(options, "superintendent")
        );
      } catch (error) {
        await restoreDocument(options.fs, options.docPath, superintendentSnapshot);
        throw toError(error);
      }

      if (superintendentResult.transition?.action !== "request_review") {
        throw new Error("Superintendent must call request_review to continue a review exchange");
      }

      publishEvent(eventChannel, "superintendent.completed", superintendentResult);
      context = {
        ...context,
        superintendent: {
          summary: superintendentResult.summary,
          ...(superintendentResult.log_path ? { log_path: superintendentResult.log_path } : {})
        },
        owner: undefined
      };
      await writeLoopState(options.fs, options.docPath, state);

      {
        const interruption = readInterruptionReason(options);
        if (interruption) {
          return finishLoop(eventChannel, state, interruption);
        }
      }

      continue;
    }

    publishEvent(eventChannel, "owner.started", {});
    const ownerSnapshot = await readDocumentContent(options.fs, options.docPath);
    let ownerResult: OwnerResult;
    try {
      ownerResult = await options.runners.ownerReview(
        await readDocument(options.fs, options.docPath),
        readTemplateContext(context),
        buildRoleOptions(options, "owner")
      );
    } catch (error) {
      await restoreDocument(options.fs, options.docPath, ownerSnapshot);
      throw toError(error);
    }
    publishEvent(eventChannel, "owner.completed", ownerResult);

    if (ownerResult.transition.action === "approve_completion") {
      context = {
        ...context,
        ...(ownerResult.log_path
          ? { owner: { ...(context.owner ?? { feedback: "" }), log_path: ownerResult.log_path } }
          : {})
      };
      state = {
        ...state,
        state: "completed"
      };
    } else {
      context = {
        ...context,
        owner: {
          feedback: ownerResult.transition.feedback,
          ...(ownerResult.log_path ? { log_path: ownerResult.log_path } : {})
        }
      };
      state = applyOwnerFeedback(
        state,
        shouldContinueReview(await readDocument(options.fs, options.docPath))
      );
    }

    emitStateChange(eventChannel, state);
    await writeLoopState(options.fs, options.docPath, state);

    if (state.state !== "review") {
      publishEvent(eventChannel, "round.completed", { round: state.round });
    }

    {
      const stopReason = readLoopStopReason(options, state, maxRounds);
      if (stopReason) {
        return finishLoop(eventChannel, state, stopReason);
      }
    }
  }
}

function buildRoleOptions(
  options: LoopRuntime,
  role: string
): { defaultCwd: string; logPath?: string } {
  return {
    defaultCwd: options.cwd,
    ...(options.logDir ? { logPath: path.join(options.logDir, makeRunLogFileName(role)) } : {})
  };
}

function shouldContinueReview(doc: SuperintendentDoc): boolean {
  return parseTaskBoard(doc.body).allDone;
}

function readTemplateContext(value: unknown): Partial<TemplateContext> {
  return isRecord(value) ? (value as Partial<TemplateContext>) : {};
}

function readScriptRunOptions(value: unknown): { maxRounds?: number } {
  if (value === undefined) {
    return {};
  }

  const record = readRecord(value, "Superintendent script options");
  return {
    ...(record.maxRounds === undefined ? {} : { maxRounds: readInteger(record.maxRounds, "maxRounds") })
  };
}

function readRunResult(value: unknown): SuperintendentRunResult {
  const record = readRecord(value, "Superintendent run result");
  const state = readLoopStateValue(record);
  return {
    ...state,
    stopReason: readStopReason(record.stopReason)
  };
}

function readLoopStateValue(value: unknown): LoopState {
  const record = readRecord(value, "Loop state");
  return {
    state: readLoopStateName(record.state),
    round: readInteger(record.round, "round"),
    reviewTurn: readInteger(record.reviewTurn, "reviewTurn"),
    maxRounds: readInteger(record.maxRounds, "maxRounds"),
    maxReviewTurns: readInteger(record.maxReviewTurns, "maxReviewTurns")
  };
}

function readLoopStateName(value: unknown): LoopState["state"] {
  if (value === "in_progress" || value === "review" || value === "completed") {
    return value;
  }

  throw new Error(`Loop state must be one of in_progress, review, completed. Received ${String(value)}.`);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function readStopReason(value: unknown): SuperintendentStopReason {
  if (
    value === "completed"
    || value === "max_rounds"
    || value === "paused"
    || value === "stopped"
    || value === "aborted"
  ) {
    return value;
  }

  throw new Error(`Invalid superintendent stop reason: ${String(value)}.`);
}

function readRoundPayload(value: unknown): number {
  return readInteger(readRecord(value, "Round event").round, "round");
}

function readNamedPayload(value: unknown): string {
  return readNonEmptyString(readRecord(value, "Named event").name, "Event name");
}

function readErrorMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }

  if (isRecord(value) && typeof value.message === "string" && value.message.length > 0) {
    return value.message;
  }

  return String(value);
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value;
}

function readInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer.`);
  }

  return value;
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a non-empty string.`);
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function ensureHarnessScriptFile(): Promise<string> {
  const scriptPath = path.join(os.tmpdir(), "poe-code", "superintendent-harness-script.md");
  await fsPromises.mkdir(path.dirname(scriptPath), { recursive: true });
  await fsPromises.writeFile(scriptPath, superintendentHarnessScript, "utf8");
  return scriptPath;
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

  const spawnApi = spawn as SpawnWithAutonomous;
  const originalAutonomous = spawnApi.autonomous;

  spawnApi.autonomous = async (agent, input) => {
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
