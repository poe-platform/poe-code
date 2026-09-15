import { Volume, createFsFromVolume } from "memfs";
import { stringify } from "yaml";
import { runPipeline } from "../../../packages/pipeline/src/run/pipeline.js";
import { parsePlan, pipelineDocumentSchemaId } from "../../../packages/pipeline/src/plan/parser.js";
import type { PipelineFileSystem } from "../../../packages/pipeline/src/types.js";
import { createDashboard } from "../../../packages/toolcraft-design/src/dashboard/dashboard.js";
import { registerDashboardQuitCommands } from "../../../src/cli/commands/dashboard-loop-shared.js";

// Real engine, in-memory files, fake agent. QA instructions live in docs/plans/qa.
const scenario = process.argv[2] ?? "completed";
const planPath = "/repo/docs/plans/fake.md";
const volume = Volume.fromJSON({
  [planPath]: [
    "---",
    stringify({
      $schema: pipelineDocumentSchemaId,
      kind: "pipeline",
      version: 1,
      tasks: Array.from({ length: 3 }, (_, index) => ({
        id: `task-${index + 1}`,
        title: `Fake task ${index + 1}`,
        prompt: "Exercise the fake agent",
        status: scenario === "nothing_to_run" ? "done" : "open"
      }))
    }).trimEnd(),
    "---",
    "# Fake pipeline"
  ].join("\n")
});
const fs = createFsFromVolume(volume).promises as unknown as PipelineFileSystem;
const dashboard = createDashboard({
  title: `Pipeline engine · ${scenario}`,
  statsTitle: "Run",
  rightPaneWidth: 32,
  hints: [
    { key: "q", label: "Cancel" },
    { key: "↑↓", label: "Scroll" },
    { key: "F", label: "Follow" }
  ]
});
const controller = new AbortController();
let finished = false;
let keepAlive: ReturnType<typeof setInterval> | undefined;
let tasksCompleted = 0;
const requestCancellation = (): void => {
  if (finished) {
    clearInterval(keepAlive);
    dashboard.destroy();
  } else {
    controller.abort();
    dashboard.updateStats({ currentAction: "Cancelling" });
  }
};
registerDashboardQuitCommands({ abortController: controller, dashboard, requestCancellation });
process.once("SIGINT", requestCancellation);
process.once("SIGTERM", requestCancellation);
dashboard.start();
const result = await runPipeline({
  agent: "codex",
  cwd: "/repo",
  homeDir: "/home/fake",
  fs,
  plan: planPath,
  logDir: "/repo/logs",
  archive: false,
  signal: controller.signal,
  ...(scenario === "max_runs" ? { maxRuns: 1 } : {}),
  onPlanResolved(summary) {
    dashboard.appendOutput({
      kind: "info",
      text: `${summary.total} tasks · ${summary.open} open`,
      ts: Date.now()
    });
  },
  onTaskStart(progress) {
    dashboard.updateStats({
      status: "running",
      iterationsLabel: "Tasks",
      currentAction: `Task ${progress.taskIndex}/${progress.totalTasks} · ${progress.taskTitle}`
    });
  },
  onTaskComplete(progress) {
    if (progress.taskCompleted) tasksCompleted += 1;
    dashboard.appendOutput({
      kind: progress.success ? "success" : "error",
      text: `${progress.taskId} ${progress.success ? "completed" : "failed"}`,
      ts: Date.now()
    });
    dashboard.updateStats({ iterations: tasksCompleted });
  },
  async runAgent(input) {
    let events = 0;
    await new Promise<void>((resolve, reject) => {
      const abort = (): void => {
        clearInterval(timer);
        input.signal?.removeEventListener("abort", abort);
        if (scenario === "cancelled-with-usage") resolve();
        else reject(Object.assign(new Error("fake agent aborted"), { name: "AbortError" }));
      };
      const timer = setInterval(() => {
        dashboard.appendOutput({
          kind: "tool",
          text: `Fake agent streaming ${++events} · ${scenario}`,
          ts: Date.now()
        });
        if (scenario !== "cancelled" && scenario !== "cancelled-with-usage" && events === 10) {
          clearInterval(timer);
          input.signal?.removeEventListener("abort", abort);
          resolve();
        }
      }, 50);
      input.signal?.addEventListener("abort", abort, { once: true });
      if (input.signal?.aborted) abort();
    });
    return {
      stdout: "fake output",
      stderr: scenario === "failed" ? "fake failure" : "",
      exitCode: scenario === "failed" ? 1 : 0,
      usage: { inputTokens: 137, outputTokens: 89 }
    };
  }
});
finished = true;
const persistedTasks = parsePlan(volume.readFileSync(planPath, "utf8") as string).tasks;
const report = (): void => {
  console.log(`ENGINE_RESULT ${result.stopReason}`);
  for (const task of persistedTasks) console.log(`TASK_STATUS ${task.id} ${task.status}`);
  console.log(`ENGINE_RUNS ${result.runsCompleted}`);
  console.log(`ENGINE_TOKENS ${result.metrics.totalInputTokens} ${result.metrics.totalOutputTokens} ${result.metrics.totalCachedTokens}`);
  console.log(`ENGINE_COUNTS ${result.metrics.tasksCompleted} ${result.metrics.tasksFailed} ${result.metrics.stepsCompleted}`);
};
process.exitCode = result.stopReason === "failed" ? 1 : result.stopReason === "cancelled" ? 130 : 0;
dashboard.updateStats({
  status: result.stopReason === "failed" ? "error" : "done",
  currentAction: result.stopReason,
  tokensIn: result.metrics.totalInputTokens,
  tokensOut: result.metrics.totalOutputTokens,
  elapsedMs: result.totalDurationMs
});
if (result.stopReason === "cancelled") {
  dashboard.destroy();
  report();
} else {
  dashboard.appendOutput({
    kind: "status",
    text: `Engine result: ${result.stopReason}`,
    ts: Date.now()
  });
  keepAlive = setInterval(() => {}, 1000);
  process.once("beforeExit", report);
}
