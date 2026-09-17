import path from "node:path";
import * as fsPromises from "node:fs/promises";
import {
  exec as nodeExec,
  spawn as nodeSpawn,
  spawnSync as nodeSpawnSync
} from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import {
  discoverPlans,
  ensureSafeRunLogDir,
  formatPlanReadinessLabel,
  resolveLoopAgent,
  resolveWorkflowPath,
  createRunQueue,
  type RunQueue,
  type RunQueueSnapshot,
  mapSourcePathIntoWorktree,
  formatRunQueueSummary,
  type RuntimeOverrideOptions
} from "@poe-code/agent-harness-tools";
import {
  applyMiddlewares,
  getSpawnConfig,
  renderAcpStream,
  sessionCapture,
  spawn,
  spawnLog,
  spawnStreaming,
  usageCapture,
  streamAcpEventsToDashboard,
  type AcpSpawnContext,
  type SpawnMode
} from "@poe-code/agent-spawn";
import { parseAgentSpecifier } from "@poe-code/agent-defs";
import {
  createWorktree,
  reconcileWorktree,
  updateWorktreeEntry,
  type Worktree,
  type WorktreeDeps,
  type WorktreeReconciliationSummary
} from "@poe-code/worktree";
import { executePoeAgent } from "./poe-agent-runner.js";
import { S, UserError, defineCommand } from "toolcraft";
import {
  acp,
  cancel,
  createDashboard,
  isCancel,
  resolveOutputFormat,
  select,
  shouldUseInteractiveDashboard,
  type Dashboard,
  type DashboardOptions
} from "toolcraft-design";
import {
  planConfigScope,
  readMergedDocument,
  readMergedDocumentReadonly,
  resolveConfigPath,
  resolveProjectConfigPath,
  resolveScope,
  type ConfigDocument
} from "@poe-code/poe-code-config/core";
import { superintendentConfigScope } from "../config-scope.js";
import { resolveSuperintendentDoc } from "../document/parse.js";
import {
  runLoop,
  type AgentRunInput,
  type AgentRunResult,
  type LoopCallbacks,
  type RunLoopOptions,
  type SuperintendentFileSystem,
  type SuperintendentRunResult
} from "../runtime/loop.js";
import { createLoopState, type LoopState } from "../state/machine.js";
import { parseTaskBoard } from "../document/tasks.js";
import { runSuperintendentSequence, type SuperintendentSequenceOptions, type SuperintendentSequenceResult } from "../runtime/sequence.js";

const execShell = promisify(nodeExec);
type SharedDiscoverPlansFs = NonNullable<Parameters<typeof discoverPlans>[0]["fs"]>;

type WorktreeExecutionOptions = boolean;

type NormalizedWorktreeOptions = {
  enabled: boolean;
  registryFile: string;
  worktreeDir: string;
};

export type SuperintendentRunCommandResult = SuperintendentRunResult & {
  docPath: string;
  builderAgent: string;
  plans?: SuperintendentSequenceResult["plans"];
  messages?: SuperintendentSequenceResult["messages"];
  queue?: RunQueueSnapshot;
};

export type RunCommandOptions = {
  cwd: string;
  homeDir: string;
  docPath?: string;
  docs?: readonly string[];
  queue?: RunQueue;
  afterEachPlan?: readonly string[];
  signal?: AbortSignal;
  sourceCwd?: string;
  builderAgent?: string;
  runtime?: "host" | "docker";
  runtimeImage?: string;
  detach?: boolean;
  mountPoeCode?: boolean;
  runnerSync?: RuntimeOverrideOptions["runnerSync"];
  configuredDefaultAgent?: string | null;
  planDirectory?: string;
  assumeYes?: boolean;
  interactive?: boolean;
  useDashboard?: boolean;
  dryRun?: boolean;
  env?: Record<string, string | undefined>;
  fs?: SuperintendentFileSystem;
  now?: () => number;
  createDashboard?: (options?: DashboardOptions) => Dashboard;
  selectPrompt?: typeof select;
  runLoop?: (options: RunLoopOptions) => Promise<SuperintendentRunResult>;
  executeAgent?: (
    agent: string,
    input: AgentRunInput
  ) => Promise<
    AgentRunResult & {
      usage?: { inputTokens: number; outputTokens: number; cachedTokens?: number };
    }
  >;
  setInterval?: typeof global.setInterval;
  clearInterval?: typeof global.clearInterval;
  openInEditor?: (absolutePath: string, env: Record<string, string | undefined>) => void;
  stderr?: NodeJS.WritableStream;
  exit?: (code: number) => never;
  worktree?: WorktreeExecutionOptions;
  worktreeDeps?: WorktreeDeps;
};

type OutputKind = "info" | "success" | "error" | "tool" | "status";

type RunSession = {
  dashboard: Dashboard;
  startedAt: number;
  state: LoopState;
  currentAction?: string;
  stopRequested: boolean;
  pauseRequested: boolean;
  paused: boolean;
  activeStage?: "builder" | "superintendent" | "owner" | { inspector: string };
  tokensIn: number;
  tokensOut: number;
  resumeWaiters: Array<() => void>;
  latestLogFile?: string;
  activity?: string;
  syncStats?: () => void;
  usageAvailable?: boolean;
};

const coreDefaultAgentConfigSchema = {
  defaultAgent: {
    type: "string" as const,
    default: "",
    env: "POE_DEFAULT_AGENT",
    doc: "Default agent used when no explicit Superintendent builder agent is provided"
  }
};

const runParams = S.Object({
  doc: S.Optional(S.String({ description: "Path to the superintendent markdown document" })),
  docs: S.Optional(
    S.Array(S.String(), {
      description: "Paths to superintendent markdown documents to run sequentially"
    })
  ),
  agent: S.Optional(
    S.String({
      description:
        "Override the builder agent for this run. Precedence: --agent > plan frontmatter builder.agent."
    })
  ),
  runtime: S.Optional(
    S.Enum(["host", "docker"] as const, {
      description: "Override runtime backend: host or docker"
    })
  ),
  runtimeImage: S.Optional(S.String({ description: "Override Docker runtime image" })),
  detach: S.Optional(S.Boolean({ description: "Run as a detached runtime job" })),
  runnerSync: S.Optional(
    S.Enum(["both", "upload", "none"] as const, {
      description: "Override runner workspace sync: both, upload, or none"
    })
  ),
  tui: S.Optional(
    S.Boolean({ description: "Show a live dashboard while Superintendent is running" })
  ),
  afterPlan: S.Optional(S.Array(S.String(), { description: "Queue a message after every completed plan (repeatable)" })),
  dryRun: S.Optional(
    S.Boolean({
      description: "Preview the loop without launching agents or writing changes",
      scope: ["cli", "sdk"],
      global: true
    })
  ),
  worktree: S.Optional(
    S.Boolean({
      description: "Run in a managed git worktree and reconcile successful output"
    })
  )
});

export const runCommand = defineCommand({
  name: "run",
  description: "Run the full superintendent loop.",
  positional: ["docs"],
  params: runParams,
  scope: ["cli", "sdk"],
  handler: async ({ params }) => {
    const cwd = process.cwd();
    const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? cwd;
    const commandConfig = await resolveSuperintendentCommandConfig(cwd, homeDir, process.env);
    const tuiEnabled = params.tui ?? commandConfig.tui;

    const docs = params.docs?.length ? params.docs : params.doc ? [params.doc] : undefined;
    const runOptions: RunCommandOptions = {
      cwd,
      homeDir,
      docs,
      afterEachPlan: params.afterPlan,
      ...(params.agent ? { builderAgent: params.agent } : {}),
      ...(params.runtime ? { runtime: params.runtime } : {}),
      ...(params.runtimeImage ? { runtimeImage: params.runtimeImage } : {}),
      ...(params.detach ? { detach: params.detach } : {}),
      ...(params.runnerSync ? { runnerSync: params.runnerSync } : {}),
      configuredDefaultAgent: commandConfig.configuredDefaultAgent,
      assumeYes: process.argv.includes("--yes"),
      interactive: Boolean(process.stdin.isTTY),
      useDashboard:
        shouldUseInteractiveDashboard(tuiEnabled) && resolveOutputFormat() === "terminal",
      dryRun: params.dryRun === true,
      worktree: pickWorktreeOptions(params),
      env: process.env,
      ...(commandConfig.planDirectory ? { planDirectory: commandConfig.planDirectory } : {})
    };
    const result = await runSuperintendentCommand(runOptions);
    if (result.queue?.status === "failed") process.exitCode = 1;
    else if (result.queue?.status === "cancelled" || result.stopReason === "aborted") process.exitCode = 130;
    return result;
  },
  render: {
    rich: (result, { logger }) => {
      if (result.stopReason === "dry_run") {
        logger.message("Superintendent preview");
        const plans = result.plans ?? [result];
        let index = 0;
        for (const item of result.queue?.items ?? [{ kind: "plan" as const, path: result.docPath }]) {
          if (item.kind === "plan") {
            logger.message(`${++index}. ${path.basename(item.path)} · ${plans[index - 1]?.builderAgent ?? result.builderAgent}`);
          } else {
            logger.message(`   ↳ ${item.text}`);
          }
        }
        return;
      }
      if (result.queue?.status === "failed") logger.error("Superintendent stopped: a queued follow-up failed.");
      else if (result.queue?.status === "cancelled" || result.stopReason === "aborted") logger.warn("Superintendent run cancelled.");
      else if (result.stopReason === "max_rounds") logger.warn("Superintendent stopped at the round limit.");
      else if (result.queue?.status === "paused" || result.stopReason === "paused" || result.stopReason === "stopped") logger.warn("Superintendent run stopped.");
      else logger.success("Superintendent completed.");
      if (result.queue) logger.message(formatRunQueueSummary(result.queue));
      logger.message(`${path.basename(result.docPath)} · ${result.builderAgent} · ${result.round} ${result.round === 1 ? "round" : "rounds"}`);
    },
    markdown: (result) => {
      const lines = [
        "## Superintendent run",
        "",
        `- Plan: ${result.docPath}`,
        `- Builder agent: ${result.builderAgent}`,
        `- Stop reason: ${result.stopReason}`,
        `- State: ${result.state}`,
        `- Round: ${result.round}`,
        `- Review turn: ${result.reviewTurn}`
      ];
      if (result.queue) lines.push(`- Queue: ${result.queue.status} · ${formatRunQueueSummary(result.queue)}`);

      return lines.join("\n");
    },
    json: (result) => result
  }
});

export type RunMcpCommandRunners = {
  runLoop?: (options: RunLoopOptions) => Promise<SuperintendentRunResult>;
};

export function createRunMcpCommand(runners?: RunMcpCommandRunners) {
  return defineCommand({
    name: "run",
    description: "Run the full superintendent loop without the dashboard UI.",
    positional: ["doc"],
    params: runParams,
    scope: ["mcp"],
    handler: async ({ params }) => {
      const cwd = process.cwd();
      const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? cwd;
      const commandConfig = await resolveSuperintendentCommandConfig(cwd, homeDir, process.env);
  
      const runOptions: RunCommandOptions = {
        cwd,
        homeDir,
        docPath: params.doc,
        docs: params.docs,
        afterEachPlan: params.afterPlan,
        ...(params.agent ? { builderAgent: params.agent } : {}),
        ...(params.runtime ? { runtime: params.runtime } : {}),
        ...(params.runtimeImage ? { runtimeImage: params.runtimeImage } : {}),
        ...(params.detach ? { detach: params.detach } : {}),
        ...(params.runnerSync ? { runnerSync: params.runnerSync } : {}),
        configuredDefaultAgent: commandConfig.configuredDefaultAgent,
        assumeYes: true,
        interactive: false,
        useDashboard: false,
        env: process.env,
          worktree: pickWorktreeOptions(params),
        ...(commandConfig.planDirectory ? { planDirectory: commandConfig.planDirectory } : {}),
        ...(runners?.runLoop ? { runLoop: runners.runLoop } : {})
      };
      return await runSuperintendentCommand(runOptions);
    },
    render: runCommand.render
  });
}

export const runMcpCommand = createRunMcpCommand();

async function resolveSuperintendentCommandConfig(
  cwd: string,
  homeDir: string,
  env: Record<string, string | undefined>,
  fs?: SuperintendentFileSystem
): Promise<{
  configDoc: ConfigDocument;
  configuredDefaultAgent: string | null;
  planDirectory?: string;
  tui: boolean;
}> {
  const configPath = resolveConfigPath(homeDir);
  const projectConfigPath = resolveProjectConfigPath(cwd);
  const document = await readSuperintendentCommandConfigDocument(
    createConfigResolutionFs(fs),
    configPath,
    projectConfigPath
  );
  const planDirectory = resolveScope(
    planConfigScope.schema,
    document.plan,
    env
  ).plan_directory?.trim();
  const superintendentResolved = resolveScope(
    superintendentConfigScope.schema,
    document[superintendentConfigScope.scope],
    env
  );
  const coreResolved = resolveScope(coreDefaultAgentConfigSchema, document.core, env);
  return {
    configDoc: document,
    configuredDefaultAgent: normalizeAgentSelection(coreResolved.defaultAgent) ?? null,
    ...(planDirectory ? { planDirectory } : {}),
    tui: superintendentResolved.tui === true
  };
}

async function readSuperintendentCommandConfigDocument(
  fs: ReturnType<typeof createConfigResolutionFs>,
  configPath: string,
  projectConfigPath: string
): Promise<ConfigDocument> {
  try {
    return await readMergedDocumentReadonly(fs, configPath, projectConfigPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UserError(`Invalid poe-code configuration: ${message}`);
  }
}

async function resolveSuperintendentPlanDirectory(
  cwd: string,
  homeDir: string,
  env: Record<string, string | undefined>,
  fs?: SuperintendentFileSystem
): Promise<string> {
  const configPath = resolveConfigPath(homeDir);
  const projectConfigPath = resolveProjectConfigPath(cwd);
  const document = await readMergedDocument(
    createConfigResolutionFs(fs),
    configPath,
    projectConfigPath
  );
  return resolveScope(planConfigScope.schema, document.plan, env).plan_directory;
}

const configFs = {
  readFile: (filePath: string, encoding: "utf8") => fsPromises.readFile(filePath, encoding),
  writeFile: async (
    filePath: string,
    content: string,
    options?: { encoding: "utf8" }
  ): Promise<void> => {
    await fsPromises.writeFile(filePath, content, options ?? { encoding: "utf8" });
  },
  mkdir: async (filePath: string, options?: { recursive: boolean }): Promise<void> => {
    await fsPromises.mkdir(filePath, options);
  },
  unlink: (filePath: string) => fsPromises.unlink(filePath),
  rename: (oldPath: string, newPath: string) => fsPromises.rename(oldPath, newPath),
  stat: async (filePath: string) => {
    const stat = await fsPromises.stat(filePath);
    return { mode: stat.mode };
  },
  lstat: async (filePath: string) => {
    const stat = await fsPromises.lstat(filePath);
    return { isSymbolicLink: () => stat.isSymbolicLink() };
  },
  readdir: (filePath: string) => fsPromises.readdir(filePath) as Promise<string[]>
};

function createConfigResolutionFs(fs?: SuperintendentFileSystem): typeof configFs {
  if (!fs) {
    return configFs;
  }

  return {
    ...configFs,
    readFile: (filePath: string, encoding: "utf8") => fs.readFile(filePath, encoding),
    writeFile: async (
      filePath: string,
      content: string,
      options?: { encoding: "utf8" }
    ): Promise<void> => {
      await fs.writeFile(filePath, content, options);
    },
    mkdir: async (filePath: string, options?: { recursive: boolean }): Promise<void> => {
      await fs.mkdir(filePath, options);
    },
    rename: (oldPath: string, newPath: string) => fs.rename(oldPath, newPath),
    lstat: async (filePath: string) => {
      return fs.lstat(filePath);
    }
  };
}

export async function runSuperintendentCommand(
  options: RunCommandOptions
): Promise<SuperintendentRunCommandResult> {
  const fs = options.fs ?? createDefaultFs();
  const now = options.now ?? Date.now;
  const selectPrompt = options.selectPrompt ?? select;
  const dashboardFactory = options.createDashboard ?? createDashboard;
  const runLoopImpl = options.runLoop ?? runLoop;
  const setIntervalImpl = options.setInterval ?? global.setInterval;
  const clearIntervalImpl = options.clearInterval ?? global.clearInterval;
  const env = options.env ?? process.env;
  const interactive = options.interactive ?? Boolean(process.stdin.isTTY);
  const assumeYes = options.assumeYes ?? false;
  const useDashboard = options.useDashboard ?? resolveOutputFormat() === "terminal";
  const stderr = options.stderr ?? process.stderr;
  const exitProcess = options.exit ?? ((code: number) => process.exit(code));


  let selectedDocPath = await resolveDocPath({
    cwd: options.cwd,
    homeDir: options.homeDir,
    docPath: options.docPath ?? options.docs?.[0] ?? options.queue?.getSnapshot().items.find((item) => item.kind === "plan")?.path,
    planDirectory: options.planDirectory,
    assumeYes,
    interactive,
    env,
    fs,
    selectPrompt
  });
  const documentContent = await fs.readFile(selectedDocPath, "utf8");
  const { document, frontmatterData } = await resolveSuperintendentDoc(
    selectedDocPath,
    documentContent,
    fs
  );
  const selectedBuilder = await resolveLoopAgent({
    providedAgent: normalizeAgentSelection(options.builderAgent),
    frontmatterAgent: normalizeAgentSelection(readConfiguredBuilderAgent(frontmatterData)),
    configuredDefaultAgent: normalizeAgentSelection(options.configuredDefaultAgent) ?? null,
    assumeYes,
    fallbackAgent: "claude-code",
    message: "Select agent to run Superintendent builder with:",
    select: selectPrompt,
    isCancel
  });

  if ("cancelled" in selectedBuilder) {
    cancel("Operation cancelled.");
    throw new UserError("Operation cancelled.");
  }

  const initialBuilderAgent = selectedBuilder.agent;
  let selectedBuilderAgent = initialBuilderAgent;

  if (options.dryRun === true) {
    const previewQueue = options.queue ?? createRunQueue({
      plans: options.docs?.length ? options.docs : [selectedDocPath],
      afterEachPlan: options.afterEachPlan,
      cwd: options.cwd
    });
    const snapshot = previewQueue.getSnapshot();
    const plans: SuperintendentSequenceResult["plans"] = [];
    for (const item of snapshot.items) {
      if (item.kind !== "plan") continue;
      const docPath = resolveWorkflowPath(item.path, options.cwd, options.homeDir);
      const resolved = docPath === selectedDocPath
        ? { document, frontmatterData }
        : await resolveSuperintendentDoc(docPath, await fs.readFile(docPath, "utf8"), fs);
      plans.push({
        ...createLoopState(resolved.document),
        stopReason: "dry_run",
        docPath,
        builderAgent: normalizeAgentSelection(options.builderAgent)
          ?? normalizeAgentSelection(readConfiguredBuilderAgent(resolved.frontmatterData))
          ?? normalizeAgentSelection(options.configuredDefaultAgent) ?? initialBuilderAgent
      });
    }
    return {
      ...plans[0]!,
      ...(snapshot.items.length > 1 ? { plans, messages: [], queue: snapshot } : {})
    };
  }

  if (isWorktreeEnabled(options.worktree)) {
    return await runSuperintendentInWorktree({
      options,
      selectedDocPath,
      selectedBuilderAgent
    });
  }

  let runLogDir = await ensureSafeRunLogDir({
    planPath: selectedDocPath,
    runner: "superintendent",
    homeDir: options.homeDir,
    fs
  });

  const queue = options.queue ?? createRunQueue({
    plans: options.docs?.length ? options.docs : [selectedDocPath], afterEachPlan: options.afterEachPlan, cwd: options.cwd
  });
  async function executeSequence(runtime: Pick<SuperintendentSequenceOptions, "signal" | "callbacks" | "runAgent" | "runPlan" | "onPlanResolved">): Promise<SuperintendentRunCommandResult> {
    const result = await runSuperintendentSequence({
      cwd: options.cwd, homeDir: options.homeDir, queue, ...(options.fs ? { fs } : {}),
      sourceCwd: options.sourceCwd,
      ...runtime,
      async preparePlan(nextDocument) {
        if (nextDocument.filePath !== selectedDocPath) {
          selectedDocPath = nextDocument.filePath;
          const content = await fs.readFile(selectedDocPath, "utf8");
          const resolved = await resolveSuperintendentDoc(selectedDocPath, content, fs);
          selectedBuilderAgent = normalizeAgentSelection(options.builderAgent)
            ?? normalizeAgentSelection(readConfiguredBuilderAgent(resolved.frontmatterData))
            ?? normalizeAgentSelection(options.configuredDefaultAgent) ?? initialBuilderAgent;
          runLogDir = await ensureSafeRunLogDir({ planPath: selectedDocPath, runner: "superintendent", homeDir: options.homeDir, fs });
        }
        return { builderAgent: selectedBuilderAgent, logDir: runLogDir };
      }
    });
    const last = result.plans.at(-1);
    if (!last) return { ...createLoopState(document), docPath: selectedDocPath, builderAgent: selectedBuilderAgent, stopReason: "aborted", queue: result.queue };
    const queueUsed = result.queue.items.length > 1;
    return {
      ...last,
      ...(result.status === "cancelled" ? { stopReason: "aborted" as const } : {}),
      ...(result.status === "paused" && last.stopReason === "completed" ? { stopReason: "stopped" as const } : {}),
      ...(queueUsed ? { plans: result.plans, messages: result.messages, queue: result.queue } : {})
    };
  }

  if (!useDashboard) {
    let activeStage: RunSession["activeStage"] = undefined;
    const headlessAbort = new AbortController();
    const headlessSigint = () => {
      headlessAbort.abort();
      exitProcess(130);
    };
    if (!options.signal) process.on("SIGINT", headlessSigint);
    try {
      return await executeSequence({
        runPlan: runLoopImpl,
        signal: options.signal ?? headlessAbort.signal,
        callbacks: {
          onBuilderStart: () => {
            activeStage = "builder";
          },
          onBuilderComplete: () => {
            activeStage = undefined;
          },
          onBuilderFailed: () => {
            activeStage = undefined;
          },
          onInspectorStart: (name) => {
            activeStage = { inspector: name };
          },
          onInspectorComplete: () => {
            activeStage = undefined;
          },
          onInspectorFailed: () => {
            activeStage = undefined;
          },
          onSuperintendentStart: () => {
            activeStage = "superintendent";
          },
          onSuperintendentComplete: () => {
            activeStage = undefined;
          },
          onOwnerStart: () => {
            activeStage = "owner";
          },
          onOwnerComplete: () => {
            activeStage = undefined;
          }
        },
        runAgent: createAgentRunner({
          session: undefined,
          executeAgent: options.executeAgent,
          selectedBuilderAgent: () => selectedBuilderAgent,
              runtime: {
            runtime: options.runtime,
            runtimeImage: options.runtimeImage,
            detach: options.detach,
            mountPoeCode: options.mountPoeCode,
            runnerSync: options.runnerSync
          },
          activeStage: () => activeStage,
          now,
          stderr
        })
      });

    } finally {
      process.off("SIGINT", headlessSigint);
    }
  }

  const session: RunSession = {
    dashboard: dashboardFactory({
      title: "Superintendent",
      appearance: "conversation",
      keymap: { pause: ["Space"] },
      async onSubmit(input) {
        if (input.kind === "message") queue.enqueueMessage(input.text, input.afterPlanId);
        else {
          const resolvedPath = resolveWorkflowPath(input.text, options.cwd, options.homeDir);
          const planPath = options.sourceCwd ? mapSourcePathIntoWorktree(options.sourceCwd, resolvedPath, options.cwd) : resolvedPath;
          await resolveSuperintendentDoc(planPath, await fs.readFile(planPath, "utf8"), fs);
          queue.enqueuePlan(planPath);
        }
      },
      statsTitle: "Loop",
      rightPaneWidth: 32,
      hints: [
        { key: "i", label: "Message" },
        { key: "p", label: "Add plan" },
        { key: "v", label: "Tasks & plans" },
        { key: "Space", label: "Pause" },
        { key: "q", label: "Quit" },
        { key: "e", label: "Edit" },
        { key: "l", label: "Log" },
        { key: "↑↓", label: "Scroll" },
        { key: "F", label: "Follow" }
      ]
    }),
    startedAt: now(),
    state: createLoopState(document),
    currentAction: undefined,
    stopRequested: false,
    pauseRequested: false,
    paused: false,
    activeStage: undefined,
    tokensIn: 0,
    tokensOut: 0,
    resumeWaiters: []
  };

  let taskBoard = parseTaskBoard(document.body);
  const abortController = new AbortController();
  const runSignal = options.signal ? AbortSignal.any([options.signal, abortController.signal]) : abortController.signal;

  const syncStats = () => {
    const snapshot = queue.getSnapshot();
    const activeItem = snapshot.items.find((item) => item.id === snapshot.activeItemId);
    session.dashboard?.updateStats({
      status: session.paused ? "paused" : snapshot.status === "running" ? "running"
        : snapshot.status === "failed" ? "error" : snapshot.status === "paused" || snapshot.status === "cancelled" ? "paused" : readDashboardStatus(session),
      iterations: session.state.round,
      tokensIn: session.tokensIn,
      tokensOut: session.tokensOut,
      usageAvailable: session.usageAvailable ?? false,
      elapsedMs: Math.max(0, now() - session.startedAt),
      currentAction: formatCurrentAction(session),
      run: {
        agent: selectedBuilderAgent, cwd: options.cwd, queue: snapshot.items, activePlanId: snapshot.activePlanId,
        phase: activeItem?.kind === "message" ? "Follow-up" : formatCurrentAction(session),
        activity: session.activity,
        tasks: taskBoard.tasks.map((task, index) => ({ id: `task-${index}`, title: task.text, status: task.done ? "completed" : "pending" }))
      }
    });
  };
  session.syncStats = syncStats;

  const unsubscribeQueue = queue.onChange((snapshot) => {
    const active = snapshot.items.find((item) => item.id === snapshot.activeItemId);
    if (active?.kind === "message" && active.status === "running") {
      session.dashboard.appendOutput({ id: active.id, kind: "info", role: "user", text: active.text, ts: now() });
    }
    syncStats();
  });

  const appendEvent = (kind: OutputKind, message: string) => {
    session.dashboard?.appendOutput({
      kind,
      text: message,
      ts: now()
    });
  };

  const callbacks: LoopCallbacks = {
    async onPause() {
      session.paused = true;
      session.pauseRequested = false;
      syncStats();
      await waitForResume(session, runSignal);
    },
    async runRole(_role, _name, run) {
      try { return await run(); }
      finally {
        try {
          const updated = await resolveSuperintendentDoc(selectedDocPath, await fs.readFile(selectedDocPath, "utf8"), fs);
          taskBoard = parseTaskBoard(updated.document.body);
        } catch (error) {
          appendEvent("error", `Task list could not refresh: ${toError(error).message}`);
        }
        syncStats();
      }
    },
    onBuilderStart: () => {
      session.activeStage = "builder";
      session.currentAction = "Builder";
      appendEvent("status", "Builder starting");
      syncStats();
    },
    onBuilderComplete: (result) => {
      session.activeStage = undefined;
      session.currentAction = undefined;
      if (result.log_path) session.latestLogFile = result.log_path;
      appendEvent("success", "Builder completed");
      syncStats();
    },
    onBuilderFailed: (error) => {
      session.activeStage = undefined;
      session.currentAction = undefined;
      appendEvent("error", `Builder failed: ${error.message}`);
      syncStats();
    },
    onInspectorStart: (name) => {
      session.activeStage = { inspector: name };
      session.currentAction = `Inspector · ${name}`;
      appendEvent("status", `Inspector ${name} starting`);
      syncStats();
    },
    onInspectorComplete: (result) => {
      session.activeStage = undefined;
      session.currentAction = undefined;
      if (result.log_path) session.latestLogFile = result.log_path;
      appendEvent("info", `Inspector ${result.name} completed`);
      syncStats();
    },
    onInspectorFailed: (name, error) => {
      session.activeStage = undefined;
      session.currentAction = undefined;
      appendEvent("error", `Inspector ${name} failed: ${error.message}`);
      syncStats();
    },
    onSuperintendentStart: () => {
      session.activeStage = "superintendent";
      session.currentAction = "Superintendent";
      appendEvent("status", "Superintendent reviewing");
      syncStats();
    },
    onSuperintendentComplete: (result) => {
      session.activeStage = undefined;
      session.currentAction = undefined;
      if (result.log_path) session.latestLogFile = result.log_path;
      appendEvent(
        "info",
        result.transition?.action === "request_review"
          ? "Superintendent requested owner review"
          : "Superintendent reviewed round"
      );
      syncStats();
    },
    onOwnerStart: () => {
      session.activeStage = "owner";
      session.currentAction = "Owner review";
      appendEvent("status", "Owner reviewing");
      syncStats();
    },
    onOwnerComplete: (result) => {
      session.activeStage = undefined;
      session.currentAction = undefined;
      if (result.log_path) session.latestLogFile = result.log_path;
      appendEvent(
        result.transition.action === "approve_completion" ? "success" : "info",
        result.transition.action === "approve_completion"
          ? "Owner approved"
          : "Owner requested changes"
      );
      syncStats();
    },
    onRoundComplete: (round) => {
      appendEvent("success", `Round ${round} completed`);
      syncStats();
    },
    onLoopComplete: (result) => {
      session.state = stripStopReason(result);
      session.activeStage = undefined;
      session.currentAction = undefined;
      if (result.stopReason === "completed") {
        appendEvent("success", "Loop completed");
      } else if (result.stopReason === "stopped") {
        appendEvent("info", "Loop stopped");
      } else if (result.stopReason === "max_rounds") {
        appendEvent("info", "Loop stopped at max rounds");
      } else if (result.stopReason === "aborted") {
        appendEvent("error", "Loop aborted");
      }
      syncStats();
    },
    onStateChange: (state) => {
      session.state = { ...state };
      syncStats();
    },
    shouldPause: () => session.pauseRequested,
    shouldStop: () => session.stopRequested
  };

  const intervalId = setIntervalImpl(() => {
    syncStats();
  }, 1_000);

  const forceQuit = () => {
    abortController.abort();
    session.dashboard.stop();
    session.dashboard.destroy();
    exitProcess(130);
  };

  const handleDashboardCommand = (command: string) => {
    if (command === "forceQuit") {
      forceQuit();
      return;
    }

    if (command === "quit") {
      if (!session.stopRequested) {
        session.stopRequested = true;
        session.pauseRequested = false;
        session.paused = false;
        appendEvent("status", "Graceful stop requested");
        releaseWaiters(session);
        syncStats();
      }
      return;
    }

    if (command === "pause") {
      if (session.paused) {
        session.paused = false;
        session.pauseRequested = false;
        appendEvent("status", "Resuming loop");
        releaseWaiters(session);
        syncStats();
        return;
      }

      session.pauseRequested = !session.pauseRequested;
      appendEvent("status", session.pauseRequested ? "Pause requested" : "Pause request cancelled");
      syncStats();
      return;
    }

    if (command === "edit") {
      const editor = resolveEditor(env);
      if (editor.mode === "tty") {
        session.pauseRequested = true;
      }
      editPlan(session.dashboard, selectedDocPath, env, options.openInEditor);
      appendEvent("info", "Plan reopened in $EDITOR");
      syncStats();
    }

    if (command === "view-log") {
      if (!session.latestLogFile) {
        appendEvent("info", "No log file available yet");
        syncStats();
        return;
      }

      const editor = resolveEditor(env);
      if (editor.mode === "tty") {
        session.pauseRequested = true;
      }
      editPlan(session.dashboard, session.latestLogFile, env, options.openInEditor);
      appendEvent("info", `Log opened: ${path.basename(session.latestLogFile)}`);
      syncStats();
    }
  };

  session.dashboard.onCommand(handleDashboardCommand);
  session.dashboard.start();
  syncStats();

  const sigintHandler = () => {
    forceQuit();
  };
  process.on("SIGINT", sigintHandler);

  let caughtError: unknown;
  try {
    return await executeSequence({
      callbacks,
      signal: runSignal,
      onPlanResolved(nextDocument) {
        session.state = createLoopState(nextDocument);
        session.currentAction = undefined;
        taskBoard = parseTaskBoard(nextDocument.body);
        syncStats();
      },
      async runPlan(loopOptions) {
        while (true) {
          session.paused = false;
          syncStats();
          const result = await runLoopImpl(loopOptions);
          session.state = stripStopReason(result);
          if (result.stopReason !== "paused") return result;
          session.paused = true;
          session.pauseRequested = false;
          syncStats();
          if (session.stopRequested) return { ...result, stopReason: "stopped" };
          await waitForResume(session, runSignal);
          if (runSignal.aborted) return { ...result, stopReason: "aborted" };
        }
      },
      runAgent: createAgentRunner({
        session,
        executeAgent: options.executeAgent,
        selectedBuilderAgent: () => selectedBuilderAgent,
          runtime: {
          runtime: options.runtime,
          runtimeImage: options.runtimeImage,
          detach: options.detach,
          mountPoeCode: options.mountPoeCode,
          runnerSync: options.runnerSync
        },
        activeStage: () => session.activeStage,
        now,
        stderr
      })
    });
  } catch (error) {
    caughtError = error;
    session.currentAction = undefined;
    session.dashboard.appendOutput({
      kind: "error",
      text: toError(error).message,
      ts: now()
    });
    session.dashboard.updateStats({
      status: "error",
      elapsedMs: Math.max(0, now() - session.startedAt)
    });
  } finally {
    unsubscribeQueue();
    clearIntervalImpl(intervalId);
    process.off("SIGINT", sigintHandler);
    session.dashboard.stop();
    session.dashboard.destroy();
  }

  const error = toError(caughtError);
  stderr.write(`Superintendent run failed: ${error.message}\n`);
  if (error.stack) {
    stderr.write(`${error.stack}\n`);
  }
  throw caughtError;
}

async function runSuperintendentInWorktree(input: {
  options: RunCommandOptions;
  selectedDocPath: string;
  selectedBuilderAgent: string;
}): Promise<SuperintendentRunCommandResult> {
  const worktreeOptions = normalizeWorktreeOptions(
    input.options.cwd,
    input.options.worktree ?? false
  );
  const deps = input.options.worktreeDeps ?? createNodeWorktreeDeps();
  const worktree = await createWorktree({
    cwd: input.options.cwd,
    name: `superintendent-${randomUUID().slice(0, 8)}`,
    baseBranch: "HEAD",
    source: "superintendent",
    agent: input.selectedBuilderAgent,
    registryFile: worktreeOptions.registryFile,
    worktreeDir: worktreeOptions.worktreeDir,
    sourceCwd: input.options.cwd,
    planPath: input.selectedDocPath,
    deps
  });

  let result: SuperintendentRunCommandResult;
  try {
    result = await runSuperintendentCommand({
      ...input.options,
      cwd: worktree.path,
      sourceCwd: input.options.sourceCwd ?? input.options.cwd,
      docPath: mapSourcePathIntoWorktree(input.options.cwd, input.selectedDocPath, worktree.path),
      builderAgent: input.selectedBuilderAgent,
      configuredDefaultAgent: input.selectedBuilderAgent,
      assumeYes: true,
      worktree: false,
      worktreeDeps: deps
    });
  } catch (error) {
    await markFailedSuperintendentWorktree({
      sourceCwd: input.options.cwd,
      worktree,
      selectedBuilderAgent: input.selectedBuilderAgent,
      worktreeOptions,
      deps
    });
    throw error;
  }

  if (result.queue?.status === "failed" || result.queue?.status === "cancelled" || result.stopReason === "aborted") {
    await markFailedSuperintendentWorktree({
      sourceCwd: input.options.cwd, worktree, selectedBuilderAgent: input.selectedBuilderAgent,
      worktreeOptions, deps, signal: input.options.signal
    });
    return result;
  }

  await reconcileWorktree({
    cwd: input.options.cwd,
    name: worktree.name,
    registryFile: worktreeOptions.registryFile,
    deps,
    reconciliationAgent: async (agentInput) => {
      const result = await spawn(input.selectedBuilderAgent, {
        cwd: agentInput.sourceCwd,
        prompt: agentInput.prompt,
        useStdin: true,
        ...(agentInput.resumeThreadId ? { resumeThreadId: agentInput.resumeThreadId } : {}),
        ...(agentInput.signal ? { signal: agentInput.signal } : {})
      });
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        ...(result.threadId ? { threadId: result.threadId } : {})
      };
    }
  });
  return result;
}

async function markFailedSuperintendentWorktree(input: {
  sourceCwd: string;
  worktree: Worktree;
  selectedBuilderAgent: string;
  worktreeOptions: NormalizedWorktreeOptions;
  deps: WorktreeDeps;
  signal?: AbortSignal;
}): Promise<void> {
  const worktreeHead = (
    await input.deps.exec("git rev-parse HEAD", {
      cwd: input.worktree.path
    })
  ).stdout.trim();
  const status = (
    await input.deps.exec("git status --porcelain=v1 -z", {
      cwd: input.worktree.path
    })
  ).stdout;
  const hasCommittedChanges =
    input.worktree.baseHead !== undefined && worktreeHead !== input.worktree.baseHead;
  const hasUncommittedChanges = status.length > 0;
  const summary: WorktreeReconciliationSummary = {
    committed: hasCommittedChanges ? "present" : "none",
    uncommitted: hasUncommittedChanges ? "present" : "none",
    removed: false,
    cleanup: "not_needed",
    conflictFiles: []
  };

  await updateWorktreeEntry(
    input.worktreeOptions.registryFile,
    input.worktree.name,
    (entry) => ({
      ...entry,
      status: "failed",
      reconciledAt: new Date().toISOString(),
      reconciliation: summary
    }),
    { fs: input.deps.fs }
  );

  if (hasCommittedChanges || hasUncommittedChanges || input.signal?.aborted) {
    return;
  }

  const result = await spawn(input.selectedBuilderAgent, {
    cwd: input.sourceCwd,
    prompt: buildFailedRunCleanupPrompt(input.worktree),
    useStdin: true
  });
  const removed =
    result.exitCode === 0 &&
    !(await managedWorktreeExists(input.sourceCwd, input.worktree, input.deps));
  await updateWorktreeEntry(
    input.worktreeOptions.registryFile,
    input.worktree.name,
    (entry) => ({
      ...entry,
      status: "failed",
      reconciledAt: new Date().toISOString(),
      reconciliation: {
        ...summary,
        removed,
        cleanup: removed ? "removed_by_agent" : "failed",
        ...(result.threadId ? { threadId: result.threadId } : {})
      }
    }),
    { fs: input.deps.fs }
  );
}

function normalizeWorktreeOptions(
  cwd: string,
  options: WorktreeExecutionOptions
): NormalizedWorktreeOptions {
  if (options === false) {
    return {
      enabled: false,
      registryFile: defaultRegistryFile(cwd),
      worktreeDir: defaultWorktreeDir(cwd)
    };
  }
  return {
    enabled: true,
    registryFile: defaultRegistryFile(cwd),
    worktreeDir: defaultWorktreeDir(cwd)
  };
}

function pickWorktreeOptions(params: { worktree?: boolean }): WorktreeExecutionOptions {
  return params.worktree === true;
}

function isWorktreeEnabled(options: WorktreeExecutionOptions | undefined): boolean {
  return options === true;
}

function defaultRegistryFile(cwd: string): string {
  return path.join(cwd, ".poe-code", "worktrees.yaml");
}

function defaultWorktreeDir(cwd: string): string {
  return path.join(cwd, ".poe-code", "worktrees");
}

function buildFailedRunCleanupPrompt(worktree: Worktree): string {
  return [
    "A poe-code managed superintendent worktree run failed and produced no worktree changes.",
    "",
    `Worktree path: ${worktree.path}`,
    `Worktree branch: ${worktree.branch}`,
    "",
    "Remove that git worktree and branch now. Then verify `git worktree list --porcelain`",
    "does not contain the path."
  ].join("\n");
}

async function managedWorktreeExists(
  sourceCwd: string,
  worktree: Worktree,
  deps: WorktreeDeps
): Promise<boolean> {
  const gitOutput = await deps.exec("git worktree list --porcelain", { cwd: sourceCwd });
  for (const line of gitOutput.stdout.split("\n")) {
    if (line === `worktree ${worktree.path}`) {
      return true;
    }
  }
  try {
    await deps.fs.lstat(worktree.path);
    return true;
  } catch {
    return false;
  }
}

function createNodeWorktreeDeps(): WorktreeDeps {
  return {
    fs: {
      readFile: async (targetPath, encoding) => await fsPromises.readFile(targetPath, encoding),
      writeFile: async (targetPath, data, options) => {
        await fsPromises.writeFile(targetPath, data, options);
      },
      mkdir: async (targetPath, options) => {
        await fsPromises.mkdir(targetPath, options);
      },
      rmdir: fsPromises.rmdir,
      rename: async (oldPath, newPath) => {
        await fsPromises.rename(oldPath, newPath);
      },
      unlink: async (targetPath) => {
        await fsPromises.unlink(targetPath);
      },
      lstat: async (targetPath) => await fsPromises.lstat(targetPath)
    },
    exec: async (command, options) => {
      const result = await execShell(command, {
        cwd: options?.cwd,
        maxBuffer: 10 * 1024 * 1024
      });
      return {
        stdout: result.stdout,
        stderr: result.stderr
      };
    }
  };
}

async function resolveDocPath(options: {
  cwd: string;
  homeDir: string;
  docPath?: string;
  planDirectory?: string;
  assumeYes: boolean;
  interactive: boolean;
  env: Record<string, string | undefined>;
  fs: SuperintendentFileSystem;
  selectPrompt: typeof select;
}): Promise<string> {
  if (options.docPath) {
    return resolveWorkflowPath(options.docPath, options.cwd, options.homeDir);
  }

  const planDirectory =
    options.planDirectory ??
    (await resolveSuperintendentPlanDirectory(
      options.cwd,
      options.homeDir,
      options.env,
      options.fs
    ));
  const docs = await discoverPlans({
    cwd: options.cwd,
    homeDir: options.homeDir,
    planDirectory: planDirectory ?? "docs/plans",
    kinds: ["superintendent"],
    fs: options.fs as unknown as SharedDiscoverPlansFs
  });

  if (docs.length === 0) {
    throw new UserError("No superintendent documents found.");
  }

  if (options.assumeYes || !options.interactive) {
    return docs[0]!.absolutePath;
  }

  const selected = await options.selectPrompt({
    message: "Select superintendent document",
    options: docs.map((doc) => ({
      label: formatPlanReadinessLabel(doc.displayPath, doc.readiness),
      value: doc.absolutePath
    })),
    initialValue: docs[0]!.absolutePath
  });

  if (isCancel(selected)) {
    cancel("Operation cancelled.");
    throw new UserError("Operation cancelled.");
  }

  return selected;
}

function normalizeAgentSelection(value?: string | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function createAgentRunner(options: {
  session: RunSession | undefined;
  executeAgent: RunCommandOptions["executeAgent"];
  selectedBuilderAgent: () => string;
  runtime: Pick<
    RunCommandOptions,
    "runtime" | "runtimeImage" | "detach" | "mountPoeCode" | "runnerSync"
  >;
  activeStage: () => RunSession["activeStage"];
  now: () => number;
  stderr: NodeJS.WritableStream;
}): RunLoopOptions["runAgent"] {
  return async (input) => {
    const activeStage = options.activeStage();
    const agent = activeStage === "builder" ? options.selectedBuilderAgent() : input.agent;
    const executeAgent =
      options.executeAgent ??
      ((nextAgent: string, nextInput: AgentRunInput) =>
        executeSpawnAgent(nextAgent, nextInput, options.session));
    const stageLabel = formatStageLabel(activeStage);

    const emitLine = (kind: OutputKind, line: string) => {
      if (line.length === 0) {
        return;
      }
      if (options.session) {
        options.session.dashboard.appendOutput({
          kind,
          text: line,
          role: "agent",
          ts: options.now()
        });
      } else {
        options.stderr.write(`[${stageLabel}] ${line}\n`);
      }
    };

    const stdoutBuffer = createLineBuffer((line) => emitLine("tool", line));
    const stderrBuffer = createLineBuffer((line) => emitLine("error", line));

    const onStdout = (chunk: string) => stdoutBuffer.push(chunk);
    const onStderr = (chunk: string) => stderrBuffer.push(chunk);

    try {
      const result = await executeAgent(agent, {
        ...input,
        ...options.runtime,
        onStdout,
        onStderr
      });

      if (options.session && result.usage) {
        options.session.tokensIn += result.usage.inputTokens;
        options.session.tokensOut += result.usage.outputTokens;
        options.session.usageAvailable = true;
      }

      return result;
    } finally {
      stdoutBuffer.flush();
      stderrBuffer.flush();
      if (options.session) {
        options.session.activity = undefined;
        options.session.syncStats?.();
      }
    }
  };
}

function createLineBuffer(emit: (line: string) => void): {
  push(chunk: string): void;
  flush(): void;
} {
  let pending = "";
  return {
    push(chunk: string): void {
      pending += chunk;
      let newlineIndex = pending.indexOf("\n");
      while (newlineIndex !== -1) {
        const raw = pending.slice(0, newlineIndex);
        const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
        emit(line);
        pending = pending.slice(newlineIndex + 1);
        newlineIndex = pending.indexOf("\n");
      }
    },
    flush(): void {
      if (pending.length > 0) {
        const line = pending.endsWith("\r") ? pending.slice(0, -1) : pending;
        emit(line);
        pending = "";
      }
    }
  };
}

function formatStageLabel(stage: RunSession["activeStage"]): string {
  if (!stage) {
    return "agent";
  }
  if (typeof stage === "string") {
    return stage;
  }
  return `inspector:${stage.inspector}`;
}

async function executeSpawnAgent(
  agent: string,
  input: AgentRunInput,
  session?: RunSession
): Promise<
  AgentRunResult & {
    usage?: { inputTokens: number; outputTokens: number; cachedTokens?: number };
  }
> {
  if (parseAgentSpecifier(agent).agent === "poe-agent") {
    return executePoeAgent(agent, input);
  }

  if ((input.onStdout || input.onStderr) && supportsStreaming(agent)) {
    return executeSpawnAgentStreaming(agent, input, session);
  }

  const tee =
    input.onStdout || input.onStderr
      ? {
          ...(input.onStdout ? { stdout: { write: input.onStdout } } : {}),
          ...(input.onStderr ? { stderr: { write: input.onStderr } } : {})
        }
      : undefined;

  const result = await spawn(agent, {
    prompt: input.prompt,
    cwd: input.cwd,
    useStdin: true,
    ...(input.mode ? { mode: input.mode as SpawnMode } : {}),
    ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.logPath ? { logPath: input.logPath } : {}),
    ...(input.runtime ? { runtime: input.runtime } : {}),
    ...(input.runtimeImage ? { runtimeImage: input.runtimeImage } : {}),
    ...(input.detach ? { detach: input.detach } : {}),
    ...(input.mountPoeCode ? { mountPoeCode: input.mountPoeCode } : {}),
    ...(input.runnerSync ? { runnerSync: input.runnerSync } : {}),
    ...(tee ? { tee } : {})
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    ...(result.logFile ? { logFile: result.logFile } : {}),
    ...(result.usage ? { usage: result.usage } : {})
  };
}

function supportsStreaming(agent: string): boolean {
  const config = getSpawnConfig(agent);
  return config?.kind === "cli";
}

async function executeSpawnAgentStreaming(
  agent: string,
  input: AgentRunInput,
  session?: RunSession
): Promise<
  AgentRunResult & {
    usage?: { inputTokens: number; outputTokens: number; cachedTokens?: number };
  }
> {
  const writer = (line: string) => {
    input.onStdout?.(`${line}\n`);
  };

  const { events: rawEvents, done } = spawnStreaming({
    agentId: agent,
    prompt: input.prompt,
    cwd: input.cwd,
    useStdin: true,
    ...(input.mode ? { mode: input.mode as SpawnMode } : {}),
    ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.runtime ? { runtime: input.runtime } : {}),
    ...(input.runtimeImage ? { runtimeImage: input.runtimeImage } : {}),
    ...(input.detach ? { detach: input.detach } : {}),
    ...(input.mountPoeCode ? { mountPoeCode: input.mountPoeCode } : {}),
    ...(input.runnerSync ? { runnerSync: input.runnerSync } : {}),
    ...(input.onStderr ? { tee: { stderr: { write: input.onStderr } } } : {})
  });

  const middlewareContext: AcpSpawnContext = {
    sessionId: "unknown",
    agent,
    events: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    eventStream: rawEvents,
    prompt: input.prompt,
    cwd: input.cwd,
    startedAt: new Date(),
    ...(input.logPath ? { logPath: input.logPath } : {}),
    ...(input.mode ? { mode: input.mode as SpawnMode } : {})
  };

  await applyMiddlewares([spawnLog, usageCapture, sessionCapture], middlewareContext);

  const stream = session
    ? streamAcpEventsToDashboard({
      events: middlewareContext.eventStream ?? rawEvents,
      signal: input.signal,
      onOutput: (item) => session.dashboard.appendOutput(item),
      onActivity(activity) { session.activity = activity; session.syncStats?.(); }
    })
    : acp.withAcpWriter(writer, () => renderAcpStream(middlewareContext.eventStream ?? rawEvents));
  const [completion, rendered] = await Promise.allSettled([done, stream]);
  if (completion.status === "rejected") throw completion.reason;
  if (rendered.status === "rejected") throw rendered.reason;
  const final = completion.value;

  const logFile = middlewareContext.logFile ?? final.logFile;
  const sessionResult = middlewareContext.sessionResult;
  return {
    stdout: final.stdout,
    stderr: final.stderr,
    exitCode: final.exitCode,
    ...(logFile ? { logFile } : {}),
    ...(sessionResult?.output ? { summary: sessionResult.output } : {}),
    ...(middlewareContext.usage.inputTokens > 0 ||
    middlewareContext.usage.outputTokens > 0 ||
    middlewareContext.usage.cachedTokens !== undefined
      ? {
          usage: {
            inputTokens: middlewareContext.usage.inputTokens,
            outputTokens: middlewareContext.usage.outputTokens,
            ...(typeof middlewareContext.usage.cachedTokens === "number"
              ? { cachedTokens: middlewareContext.usage.cachedTokens }
              : {})
          }
        }
      : {}),
    ...(sessionResult?.toolCalls.length
      ? {
          toolCalls: sessionResult.toolCalls.flatMap((toolCall) =>
            typeof toolCall.title === "string"
              ? [
                  {
                    title: toolCall.title,
                    ...(toolCall.status ? { status: toolCall.status } : {}),
                    ...(toolCall.input !== undefined ? { input: toolCall.input } : {})
                  }
                ]
              : []
          )
        }
      : {})
  };
}

function readDashboardStatus(
  session: RunSession
): "idle" | "running" | "paused" | "done" | "error" {
  if (session.paused) {
    return "paused";
  }

  if (session.state.state === "completed") {
    return "done";
  }

  return "running";
}

function formatCurrentAction(session: RunSession): string {
  if (session.paused) {
    return "Paused · Space to resume";
  }
  if (session.stopRequested) return "Stopping after current action";
  if (session.pauseRequested) return "Pausing after current action";
  const action = session.currentAction
    ?? (session.state.state === "completed" ? "Plan completed" : session.state.state === "review" ? "Owner review" : "Preparing");
  return session.state.round > 0 ? `Round ${session.state.round} · ${action}` : action;
}

function editPlan(
  dashboard: Dashboard,
  absolutePath: string,
  env: Record<string, string | undefined>,
  openInEditor: RunCommandOptions["openInEditor"]
): void {
  const editor = resolveEditor(env);
  const open = openInEditor ?? openInEditorWithSystem;

  if (editor.mode === "gui") {
    open(absolutePath, env);
    return;
  }

  dashboard.stop();
  try {
    open(absolutePath, env);
  } finally {
    dashboard.start();
  }
}

function openInEditorWithSystem(
  absolutePath: string,
  env: Record<string, string | undefined>
): void {
  const editor = resolveEditor(env);
  if (editor.mode === "gui") {
    const child = nodeSpawn(editor.command, [...editor.args, absolutePath], {
      stdio: "ignore",
      detached: true
    });
    child.unref();
    return;
  }
  nodeSpawnSync(editor.command, [...editor.args, absolutePath], { stdio: "inherit" });
}

type ResolvedEditor = {
  command: string;
  args: string[];
  mode: "gui" | "tty";
};

const GUI_EDITOR_BINARIES = new Set(["code", "code-insiders", "cursor", "windsurf", "subl"]);

function resolveEditor(env: Record<string, string | undefined>): ResolvedEditor {
  const raw = (env.EDITOR?.trim() || env.VISUAL?.trim() || "").trim();

  if (raw.length === 0) {
    if (env.TERM_PROGRAM === "vscode") {
      return { command: "code", args: [], mode: "gui" };
    }
    return { command: "vi", args: [], mode: "tty" };
  }

  const parts = raw.split(/\s+/);
  const command = parts[0] ?? "vi";
  const args = parts.slice(1);
  const binary = path.basename(command);
  const mode: "gui" | "tty" = GUI_EDITOR_BINARIES.has(binary) ? "gui" : "tty";
  return { command, args, mode };
}

function releaseWaiters(session: RunSession): void {
  while (session.resumeWaiters.length > 0) {
    session.resumeWaiters.shift()?.();
  }
}

async function waitForResume(session: RunSession, signal?: AbortSignal): Promise<void> {
  if (session.stopRequested || !session.paused || signal?.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    const finish = () => {
      signal?.removeEventListener("abort", finish);
      const index = session.resumeWaiters.indexOf(finish);
      if (index !== -1) session.resumeWaiters.splice(index, 1);
      resolve();
    };
    session.resumeWaiters.push(finish);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

function stripStopReason(result: SuperintendentRunResult): LoopState {
  return {
    state: result.state,
    round: result.round,
    reviewTurn: result.reviewTurn,
    maxRounds: result.maxRounds,
    maxReviewTurns: result.maxReviewTurns
  };
}

function readConfiguredBuilderAgent(frontmatter: Record<string, unknown>): string | undefined {
  const builder = frontmatter.builder;

  if (typeof builder !== "object" || builder === null || Array.isArray(builder)) {
    return undefined;
  }

  const agent = (builder as Record<string, unknown>).agent;
  return typeof agent === "string" ? agent : undefined;
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
    mkdir: async (filePath: string, mkdirOptions?: { recursive?: boolean }) => {
      await fsPromises.mkdir(filePath, mkdirOptions);
    },
    rmdir: async (filePath: string) => {
      await fsPromises.rmdir(filePath);
    },
    rename: async (oldPath: string, newPath: string) => {
      await fsPromises.rename(oldPath, newPath);
    },
    unlink: async (filePath: string) => {
      await fsPromises.unlink(filePath);
    },
    realpath: fsPromises.realpath
  };

  return fs as SuperintendentFileSystem;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
