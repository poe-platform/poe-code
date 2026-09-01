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
  text,
  type Dashboard
} from "toolcraft-design";
import {
  planConfigScope,
  mergeLoopCallbacks,
  readMergedDocument,
  readMergedDocumentReadonly,
  resolveConfigPath,
  resolveProjectConfigPath,
  resolveScope,
  type ConfigDocument
} from "@poe-code/poe-code-config";
import { loadIntegrations, type Integrations } from "@poe-code/braintrust";
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
};

export type RunCommandOptions = {
  cwd: string;
  homeDir: string;
  docPath?: string;
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
  createDashboard?: (options?: {
    title?: string;
    statsTitle?: string;
    hints?: Array<{ key: string; label: string }>;
    rightPaneWidth?: number;
  }) => Dashboard;
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
  integrations?: Integrations | null;
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
    const integrations = await loadIntegrations(commandConfig.configDoc);
    const tuiEnabled = params.tui ?? commandConfig.tui;

    try {
      const docs: Array<string | undefined> =
        params.docs && params.docs.length > 0 ? params.docs : [params.doc];
      let result: Awaited<ReturnType<typeof runSuperintendentCommand>> | undefined;
      for (const doc of docs) {
        const runOptions: RunCommandOptions = {
          cwd,
          homeDir,
          docPath: doc,
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
          integrations,
          ...(commandConfig.planDirectory ? { planDirectory: commandConfig.planDirectory } : {})
        };
        result = integrations
          ? await integrations.traceRun("superintendent", doc ?? "run", () =>
              runSuperintendentCommand(runOptions)
            )
          : await runSuperintendentCommand(runOptions);
      }
      if (!result) {
        throw new UserError("No superintendent plan was selected.");
      }
      return result;
    } finally {
      await integrations?.shutdown().catch(() => undefined);
    }
  },
  render: {
    rich: (result, { logger }) => {
      logger.success(`Superintendent run finished: ${result.stopReason}.`);
      logger.message(text.section("Run:"));
      logger.message(`Plan: ${result.docPath}`);
      logger.message(`Builder agent: ${result.builderAgent}`);
      logger.message(`State: ${result.state}`);
      logger.message(`Round: ${result.round}`);
      if (result.state === "review") {
        logger.message(`Review turn: ${result.reviewTurn}`);
      }
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
      const integrations = await loadIntegrations(commandConfig.configDoc);

      try {
        const runOptions: RunCommandOptions = {
          cwd,
          homeDir,
          docPath: params.doc,
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
          integrations,
          worktree: pickWorktreeOptions(params),
          ...(commandConfig.planDirectory ? { planDirectory: commandConfig.planDirectory } : {}),
          ...(runners?.runLoop ? { runLoop: runners.runLoop } : {})
        };
        return integrations
          ? await integrations.traceRun("superintendent", params.doc ?? "run", () =>
              runSuperintendentCommand(runOptions)
            )
          : await runSuperintendentCommand(runOptions);
      } finally {
        await integrations?.shutdown().catch(() => undefined);
      }
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
  const integrations = options.integrations ?? null;
  const shutdownAndExit = (code: number): void => {
    if (!integrations) {
      exitProcess(code);
      return;
    }
    void integrations.shutdown().finally(() => {
      exitProcess(code);
    });
  };

  const selectedDocPath = await resolveDocPath({
    cwd: options.cwd,
    homeDir: options.homeDir,
    docPath: options.docPath,
    planDirectory: options.planDirectory,
    assumeYes,
    interactive,
    env,
    fs,
    selectPrompt
  });
  const runLogDir = await ensureSafeRunLogDir({
    planPath: selectedDocPath,
    runner: "superintendent",
    homeDir: options.homeDir,
    fs
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

  const selectedBuilderAgent = selectedBuilder.agent;

  if (options.dryRun === true) {
    return {
      ...createLoopState(document),
      stopReason: "dry_run",
      docPath: selectedDocPath,
      builderAgent: selectedBuilderAgent
    };
  }

  if (isWorktreeEnabled(options.worktree)) {
    return await runSuperintendentInWorktree({
      options,
      selectedDocPath,
      selectedBuilderAgent
    });
  }

  if (!useDashboard) {
    let activeStage: RunSession["activeStage"] = undefined;
    const headlessAbort = new AbortController();
    const headlessSigint = () => {
      headlessAbort.abort();
      shutdownAndExit(130);
    };
    process.on("SIGINT", headlessSigint);
    try {
      const result = await runLoopImpl({
        docPath: selectedDocPath,
        cwd: options.cwd,
        homeDir: options.homeDir,
        ...(options.fs ? { fs } : {}),
        signal: headlessAbort.signal,
        logDir: runLogDir,
        callbacks: mergeLoopCallbacks(
          {
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
          integrations?.superintendentCallbacks
        ),
        runAgent: createAgentRunner({
          session: undefined,
          executeAgent: options.executeAgent,
          selectedBuilderAgent,
          integrations,
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

      return {
        ...result,
        docPath: selectedDocPath,
        builderAgent: selectedBuilderAgent
      };
    } finally {
      process.off("SIGINT", headlessSigint);
    }
  }

  const session: RunSession = {
    dashboard: dashboardFactory({
      title: "Superintendent",
      statsTitle: "Loop",
      rightPaneWidth: 32,
      hints: [
        { key: "q", label: "Quit" },
        { key: "e", label: "Edit" },
        { key: "l", label: "Log" },
        { key: "p", label: "Pause" },
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

  const syncStats = () => {
    session.dashboard?.updateStats({
      status: readDashboardStatus(session),
      iterations: session.state.round,
      tokensIn: session.tokensIn,
      tokensOut: session.tokensOut,
      elapsedMs: Math.max(0, now() - session.startedAt),
      currentAction: formatCurrentAction(session)
    });
  };

  const appendEvent = (kind: OutputKind, message: string) => {
    session.dashboard?.appendOutput({
      kind,
      text: `${formatTimestamp(now())} ${message}`,
      ts: now()
    });
  };

  const callbacks: LoopCallbacks = {
    onBuilderStart: () => {
      session.activeStage = "builder";
      session.currentAction = "builder";
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
      session.currentAction = `inspector: ${name}`;
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
      session.currentAction = "superintendent";
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
      session.currentAction = "owner";
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

  const abortController = new AbortController();

  const forceQuit = () => {
    abortController.abort();
    session.dashboard.stop();
    session.dashboard.destroy();
    shutdownAndExit(130);
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
    while (true) {
      session.paused = false;
      syncStats();

      const result = await runLoopImpl({
        docPath: selectedDocPath,
        cwd: options.cwd,
        homeDir: options.homeDir,
        ...(options.fs ? { fs } : {}),
        callbacks: mergeLoopCallbacks(callbacks, integrations?.superintendentCallbacks),
        signal: abortController.signal,
        logDir: runLogDir,
        runAgent: createAgentRunner({
          session,
          executeAgent: options.executeAgent,
          selectedBuilderAgent,
          integrations,
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

      session.state = stripStopReason(result);

      if (result.stopReason === "paused") {
        session.paused = true;
        session.pauseRequested = false;
        syncStats();

        if (session.stopRequested) {
          return {
            ...session.state,
            stopReason: "stopped",
            docPath: selectedDocPath,
            builderAgent: selectedBuilderAgent
          };
        }

        await waitForResume(session);
        continue;
      }

      return {
        ...result,
        docPath: selectedDocPath,
        builderAgent: selectedBuilderAgent
      };
    }
  } catch (error) {
    caughtError = error;
    session.currentAction = undefined;
    session.dashboard.appendOutput({
      kind: "error",
      text: `${formatTimestamp(now())} ${toError(error).message}`,
      ts: now()
    });
    session.dashboard.updateStats({
      status: "error",
      elapsedMs: Math.max(0, now() - session.startedAt)
    });
  } finally {
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

  if (hasCommittedChanges || hasUncommittedChanges) {
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

function mapSourcePathIntoWorktree(
  sourceCwd: string,
  sourcePath: string,
  worktreeCwd: string
): string {
  if (!path.isAbsolute(sourcePath)) {
    return sourcePath;
  }
  const relativePath = path.relative(sourceCwd, sourcePath);
  if (relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))) {
    return path.join(worktreeCwd, relativePath);
  }
  return sourcePath;
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
  selectedBuilderAgent: string;
  integrations: Integrations | null;
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
    const agent = activeStage === "builder" ? options.selectedBuilderAgent : input.agent;
    const executeAgent =
      options.executeAgent ??
      ((nextAgent: string, nextInput: AgentRunInput) =>
        executeSpawnAgent(nextAgent, nextInput, options.integrations));
    const stageLabel = formatStageLabel(activeStage);

    const emitLine = (kind: OutputKind, line: string) => {
      if (line.length === 0) {
        return;
      }
      if (options.session) {
        options.session.dashboard.appendOutput({
          kind,
          text: `${formatTimestamp(options.now())} [${stageLabel}] ${line}`,
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
      }

      return result;
    } finally {
      stdoutBuffer.flush();
      stderrBuffer.flush();
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
  integrations: Integrations | null
): Promise<
  AgentRunResult & {
    usage?: { inputTokens: number; outputTokens: number; cachedTokens?: number };
  }
> {
  if (parseAgentSpecifier(agent).agent === "poe-agent") {
    return executePoeAgent(agent, input);
  }

  if ((input.onStdout || input.onStderr) && supportsStreaming(agent)) {
    return executeSpawnAgentStreaming(agent, input, integrations);
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
  integrations: Integrations | null
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

  await applyMiddlewares(
    [
      spawnLog,
      usageCapture,
      sessionCapture,
      ...(integrations?.spawnMiddleware ? [integrations.spawnMiddleware] : [])
    ],
    middlewareContext
  );

  await acp.withAcpWriter(writer, () =>
    renderAcpStream(middlewareContext.eventStream ?? rawEvents)
  );
  const final = await done;

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
    return "paused";
  }

  const segments = [
    `state=${session.state.state}`,
    `round=${session.state.round}`,
    ...(session.state.state === "review" ? [`review=${session.state.reviewTurn}`] : []),
    ...(session.currentAction ? [session.currentAction] : [])
  ];

  return segments.join(" · ");
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `[${hours}:${minutes}:${seconds}]`;
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

async function waitForResume(session: RunSession): Promise<void> {
  if (session.stopRequested || !session.paused) {
    return;
  }

  await new Promise<void>((resolve) => {
    session.resumeWaiters.push(resolve);
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
