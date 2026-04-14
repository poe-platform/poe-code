import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createDashboard } from "./dashboard.js";
import type { Dashboard } from "./dashboard.js";
import type { OutputItemKind } from "./types.js";

const OUTPUT_INTERVAL_MS = 500;
const STATS_INTERVAL_MS = 1_000;
const DEMO_DURATION_MS = 30_000;
const TOKENS_IN_PER_ITERATION = 137;
const TOKENS_OUT_PER_ITERATION = 89;
const OUTPUT_KINDS: OutputItemKind[] = ["info", "success", "error", "tool", "status"];
const OUTPUT_MESSAGES: Record<OutputItemKind, string[]> = {
  info: [
    "Analyzing repository state",
    "Inspecting agent configuration",
    "Collecting recent command output"
  ],
  success: [
    "Generated provider config",
    "Updated dashboard layout",
    "Saved session checkpoint"
  ],
  error: [
    "Retrying transient network request",
    "Tool execution returned a non-zero exit code",
    "Encountered a recoverable validation error"
  ],
  tool: [
    "Running npm test -- --runInBand",
    "Executing npm run lint:types",
    "Opening task plan documentation"
  ],
  status: [
    "Waiting for follow-up task",
    "Streaming model response",
    "Syncing derived metrics"
  ]
};
const RUNNING_ACTIONS = [
  "Planning next step",
  "Executing tool call",
  "Reviewing tool results",
  "Updating working memory",
  "Preparing final response"
];
const INITIAL_ACTION = "Connecting to provider";
const COMPLETED_ACTION = "Completed";

type DemoDashboard = Pick<Dashboard, "appendOutput" | "updateStats">;

type DemoRuntime = {
  setInterval: typeof globalThis.setInterval;
  clearInterval: typeof globalThis.clearInterval;
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
  now: () => number;
  random: () => number;
};

export function startDashboardDemo(
  dashboard: DemoDashboard,
  runtime: Partial<DemoRuntime> = {}
): () => void {
  const setIntervalFn = runtime.setInterval ?? globalThis.setInterval.bind(globalThis);
  const clearIntervalFn = runtime.clearInterval ?? globalThis.clearInterval.bind(globalThis);
  const setTimeoutFn = runtime.setTimeout ?? globalThis.setTimeout.bind(globalThis);
  const clearTimeoutFn = runtime.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
  const now = runtime.now ?? Date.now;
  const random = runtime.random ?? Math.random;

  let outputCount = 0;
  let iterations = 0;
  let cleanedUp = false;

  dashboard.updateStats({
    status: "running",
    currentAction: INITIAL_ACTION
  });

  const outputTimer = setIntervalFn(() => {
    const kind = OUTPUT_KINDS[outputCount % OUTPUT_KINDS.length] ?? "info";

    dashboard.appendOutput({
      kind,
      text: pickOutputMessage(kind, random),
      ts: now()
    });

    outputCount += 1;
  }, OUTPUT_INTERVAL_MS);

  const statsTimer = setIntervalFn(() => {
    iterations += 1;

    dashboard.updateStats({
      status: "running",
      iterations,
      tokensIn: iterations * TOKENS_IN_PER_ITERATION,
      tokensOut: iterations * TOKENS_OUT_PER_ITERATION,
      elapsedMs: iterations * STATS_INTERVAL_MS,
      currentAction: RUNNING_ACTIONS[(iterations - 1) % RUNNING_ACTIONS.length] ?? INITIAL_ACTION
    });
  }, STATS_INTERVAL_MS);

  const finishTimeout = setTimeoutFn(() => {
    cleanup();
    dashboard.updateStats({
      status: "done",
      iterations,
      tokensIn: iterations * TOKENS_IN_PER_ITERATION,
      tokensOut: iterations * TOKENS_OUT_PER_ITERATION,
      elapsedMs: DEMO_DURATION_MS,
      currentAction: COMPLETED_ACTION
    });
  }, DEMO_DURATION_MS);

  function cleanup(): void {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    clearTimeoutFn(finishTimeout);
    clearIntervalFn(outputTimer);
    clearIntervalFn(statsTimer);
  }

  return cleanup;
}

function pickOutputMessage(kind: OutputItemKind, random: () => number): string {
  const options = OUTPUT_MESSAGES[kind];
  const cappedRandom = Math.max(0, Math.min(0.999_999, random()));
  const index = Math.floor(cappedRandom * options.length);

  return options[index] ?? options[0] ?? kind;
}

export async function main(): Promise<void> {
  const dashboard = createDashboard({ title: "Agent Output", statsTitle: "Stats" });
  const stopDemo = startDashboardDemo(dashboard);
  let shutDown = false;

  const shutdown = (exitCode?: number): void => {
    if (shutDown) {
      return;
    }

    shutDown = true;
    stopDemo();
    dashboard.destroy();

    if (exitCode !== undefined) {
      process.exit(exitCode);
    }
  };

  dashboard.onCommand((command) => {
    if (command === "quit") {
      shutdown(0);
    }
  });

  process.once("SIGINT", () => {
    shutdown(0);
  });
  process.once("SIGTERM", () => {
    shutdown(0);
  });

  dashboard.start();
}

const entry = process.argv[1];
const isMain = typeof entry === "string" && path.resolve(entry) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
