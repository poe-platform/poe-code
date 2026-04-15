import path from "node:path";
import * as fsPromises from "node:fs/promises";
import { spawnSync as nodeSpawnSync } from "node:child_process";
import { discoverWorkflowDocs, resolveWorkflowPath } from "@poe-code/agent-kit";
import { allSpawnConfigs, spawn } from "@poe-code/agent-spawn";
import { allAgents, resolveAgentId } from "@poe-code/agent-defs";
import { S, UserError, defineCommand } from "@poe-code/cmdkit";
import {
  cancel,
  createDashboard,
  isCancel,
  resolveOutputFormat,
  select,
  text,
  type Dashboard
} from "@poe-code/design-system";
import { parseSuperintendentDoc } from "../document/parse.js";
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

export type SuperintendentRunCommandResult = SuperintendentRunResult & {
  docPath: string;
  builderAgent: string;
};

export type RunCommandOptions = {
  cwd: string;
  homeDir: string;
  docPath?: string;
  builderAgent?: string;
  assumeYes?: boolean;
  interactive?: boolean;
  useDashboard?: boolean;
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
  executeAgent?: (agent: string, input: AgentRunInput) => Promise<AgentRunResult & {
    usage?: { inputTokens: number; outputTokens: number; cachedTokens?: number };
  }>;
  setInterval?: typeof global.setInterval;
  clearInterval?: typeof global.clearInterval;
  openInEditor?: (absolutePath: string, env: Record<string, string | undefined>) => void;
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
  pendingEdit: boolean;
  activeStage?: "builder" | "superintendent" | "owner" | { inspector: string };
  tokensIn: number;
  tokensOut: number;
  resumeWaiters: Array<() => void>;
};

const runParams = S.Object({
  doc: S.Optional(S.String({ description: "Path to the superintendent markdown document" })),
  agent: S.Optional(S.String({ description: "Override the builder agent" }))
});

export const runCommand = defineCommand({
  name: "run",
  description: "Run the full superintendent loop with the live dashboard UI.",
  positional: ["doc"],
  params: runParams,
  scope: ["cli", "sdk"],
  handler: async ({ params }) => {
    const cwd = process.cwd();
    const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? cwd;

    return runSuperintendentCommand({
      cwd,
      homeDir,
      docPath: params.doc,
      builderAgent: params.agent,
      assumeYes: process.argv.includes("--yes"),
      interactive: Boolean(process.stdin.isTTY),
      useDashboard: resolveOutputFormat() === "terminal",
      env: process.env
    });
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

export const runMcpCommand = defineCommand({
  name: "run",
  description: "Run the full superintendent loop without the dashboard UI.",
  positional: ["doc"],
  params: runParams,
  scope: ["mcp"],
  handler: async ({ params }) => {
    const cwd = process.cwd();
    const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? cwd;

    return runSuperintendentCommand({
      cwd,
      homeDir,
      docPath: params.doc,
      builderAgent: params.agent,
      assumeYes: true,
      interactive: false,
      useDashboard: false,
      env: process.env
    });
  },
  render: runCommand.render
});

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

  const selectedDocPath = await resolveDocPath({
    cwd: options.cwd,
    homeDir: options.homeDir,
    docPath: options.docPath,
    assumeYes,
    interactive,
    fs,
    selectPrompt
  });
  const document = parseSuperintendentDoc(selectedDocPath, await fs.readFile(selectedDocPath, "utf8"));
  const selectedBuilderAgent = await resolveBuilderAgent({
    document,
    explicitAgent: options.builderAgent,
    assumeYes,
    interactive,
    selectPrompt
  });

  if (!useDashboard) {
    let activeStage: RunSession["activeStage"] = undefined;
    const result = await runLoopImpl({
      docPath: selectedDocPath,
      cwd: options.cwd,
      homeDir: options.homeDir,
      ...(options.fs ? { fs } : {}),
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
        selectedBuilderAgent,
        activeStage: () => activeStage
      })
    });

    return {
      ...result,
      docPath: selectedDocPath,
      builderAgent: selectedBuilderAgent
    };
  }

  const session: RunSession = {
    dashboard: dashboardFactory({
      title: "Superintendent",
      statsTitle: "Loop",
      rightPaneWidth: 32,
      hints: [
        { key: "q", label: "Quit" },
        { key: "e", label: "Edit" },
        { key: "p", label: "Pause" },
        { key: "↑↓", label: "Scroll" }
      ]
    }),
    startedAt: now(),
    state: createLoopState(document),
    currentAction: undefined,
    stopRequested: false,
    pauseRequested: false,
    paused: false,
    pendingEdit: false,
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
    onBuilderComplete: () => {
      session.activeStage = undefined;
      session.currentAction = undefined;
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

  const handleDashboardCommand = (command: string) => {
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
      appendEvent(
        "status",
        session.pauseRequested ? "Pause requested" : "Pause request cancelled"
      );
      syncStats();
      return;
    }

    if (command === "edit") {
      if (session.paused) {
        editPlan(session.dashboard, selectedDocPath, env, options.openInEditor);
        appendEvent("info", "Plan reopened in $EDITOR");
        syncStats();
        return;
      }

      session.pendingEdit = true;
      session.pauseRequested = true;
      appendEvent("status", "Edit requested after current agent");
      syncStats();
    }
  };

  session.dashboard.onCommand(handleDashboardCommand);
  session.dashboard.start();
  syncStats();

  const sigintHandler = () => {
    handleDashboardCommand("quit");
  };
  process.on("SIGINT", sigintHandler);

  try {
    while (true) {
      session.paused = false;
      syncStats();

      const result = await runLoopImpl({
        docPath: selectedDocPath,
        cwd: options.cwd,
        homeDir: options.homeDir,
        ...(options.fs ? { fs } : {}),
        callbacks,
        runAgent: createAgentRunner({
          session,
          executeAgent: options.executeAgent,
          selectedBuilderAgent,
          activeStage: () => session.activeStage
        })
      });

      session.state = stripStopReason(result);

      if (result.stopReason === "paused") {
        session.paused = true;
        session.pauseRequested = false;
        syncStats();

        if (session.pendingEdit) {
          session.pendingEdit = false;
          editPlan(session.dashboard, selectedDocPath, env, options.openInEditor);
          appendEvent("info", "Plan reopened in $EDITOR");
          syncStats();
        }

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
    throw error;
  } finally {
    clearIntervalImpl(intervalId);
    process.off("SIGINT", sigintHandler);
    session.dashboard.stop();
    session.dashboard.destroy();
  }
}

async function resolveDocPath(options: {
  cwd: string;
  homeDir: string;
  docPath?: string;
  assumeYes: boolean;
  interactive: boolean;
  fs: SuperintendentFileSystem;
  selectPrompt: typeof select;
}): Promise<string> {
  if (options.docPath) {
    return resolveWorkflowPath(options.docPath, options.cwd, options.homeDir);
  }

  const docs = await discoverSuperintendentDocs(options);

  if (docs.length === 0) {
    throw new UserError("No superintendent documents found.");
  }

  if (options.assumeYes || !options.interactive) {
    return docs[0]!;
  }

  const selected = await options.selectPrompt({
    message: "Select superintendent document",
    options: docs.map((docPath) => ({
      label: displayPath(docPath, options.cwd, options.homeDir),
      value: docPath
    })),
    initialValue: docs[0]
  });

  if (isCancel(selected)) {
    cancel("Operation cancelled.");
    throw new UserError("Operation cancelled.");
  }

  return selected;
}

async function discoverSuperintendentDocs(options: {
  cwd: string;
  homeDir: string;
  fs: SuperintendentFileSystem;
}): Promise<string[]> {
  const docs = await discoverWorkflowDocs({
    cwd: options.cwd,
    homeDir: options.homeDir,
    subDirectory: "superintendent",
    fs: { readdir: options.fs.readdir }
  });
  const matches: string[] = [];

  for (const docPath of docs) {
    try {
      const content = await options.fs.readFile(docPath, "utf8");
      const document = parseSuperintendentDoc(docPath, content);
      if (document.frontmatter.kind === "superintendent") {
        matches.push(docPath);
      }
    } catch {
      // Ignore invalid docs during discovery.
    }
  }

  return matches;
}

async function resolveBuilderAgent(options: {
  document: ReturnType<typeof parseSuperintendentDoc>;
  explicitAgent?: string;
  assumeYes: boolean;
  interactive: boolean;
  selectPrompt: typeof select;
}): Promise<string> {
  if (options.explicitAgent) {
    return resolveAgentId(options.explicitAgent) ?? options.explicitAgent;
  }

  const defaultAgent = resolveAgentId(options.document.frontmatter.builder.agent) ?? options.document.frontmatter.builder.agent;

  if (options.assumeYes || !options.interactive) {
    return defaultAgent;
  }

  const agents = listSelectableAgents(defaultAgent);
  const selected = await options.selectPrompt({
    message: "Select builder agent",
    options: agents.map((agent) => ({ label: agent, value: agent })),
    initialValue: defaultAgent
  });

  if (isCancel(selected)) {
    cancel("Operation cancelled.");
    throw new UserError("Operation cancelled.");
  }

  return resolveAgentId(selected) ?? selected;
}

function listSelectableAgents(defaultAgent: string): string[] {
  const available = new Set<string>([
    ...allSpawnConfigs.map((config) => config.agentId),
    ...allAgents.map((agent) => agent.id),
    defaultAgent
  ]);

  return [...available].sort((left, right) => left.localeCompare(right));
}

function createAgentRunner(options: {
  session: RunSession | undefined;
  executeAgent: RunCommandOptions["executeAgent"];
  selectedBuilderAgent: string;
  activeStage: () => RunSession["activeStage"];
}): RunLoopOptions["runAgent"] {
  return async (input) => {
    const activeStage = options.activeStage();
    const agent = activeStage === "builder" ? options.selectedBuilderAgent : input.agent;
    const executeAgent = options.executeAgent ?? executeSpawnAgent;
    const result = await executeAgent(agent, input);

    if (options.session && result.usage) {
      options.session.tokensIn += result.usage.inputTokens;
      options.session.tokensOut += result.usage.outputTokens;
    }

    return result;
  };
}

async function executeSpawnAgent(
  agent: string,
  input: AgentRunInput
): Promise<AgentRunResult & {
  usage?: { inputTokens: number; outputTokens: number; cachedTokens?: number };
}> {
  const result = await spawn(agent, {
    prompt: input.prompt,
    cwd: input.cwd,
    ...(input.mode ? { mode: input.mode as "read" | "edit" | "yolo" } : {}),
    ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
    ...(input.signal ? { signal: input.signal } : {})
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    ...(result.usage ? { usage: result.usage } : {})
  };
}

function readDashboardStatus(session: RunSession): "idle" | "running" | "paused" | "done" | "error" {
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
    return session.pendingEdit ? "paused · waiting to edit plan" : "paused";
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
  dashboard.stop();

  try {
    (openInEditor ?? openInEditorWithSystem)(absolutePath, env);
  } finally {
    dashboard.start();
  }
}

function openInEditorWithSystem(
  absolutePath: string,
  env: Record<string, string | undefined>
): void {
  const editor = resolveEditor(env);
  nodeSpawnSync(editor, [absolutePath], { stdio: "inherit" });
}

function resolveEditor(env: Record<string, string | undefined>): string {
  const editor = env.EDITOR?.trim() || env.VISUAL?.trim() || "vi";
  return editor.length > 0 ? editor : "vi";
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

function displayPath(filePath: string, cwd: string, homeDir: string): string {
  if (filePath.startsWith(`${cwd}${path.sep}`)) {
    return path.relative(cwd, filePath);
  }

  if (filePath.startsWith(`${homeDir}${path.sep}`)) {
    return `~/${path.relative(homeDir, filePath)}`;
  }

  return filePath;
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
    mkdir: async (filePath, mkdirOptions) => {
      await fsPromises.mkdir(filePath, mkdirOptions);
    },
    rmdir: async (filePath) => {
      await fsPromises.rmdir(filePath);
    },
    rename: async (oldPath, newPath) => {
      await fsPromises.rename(oldPath, newPath);
    }
  };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
