import { createDashboard } from "../../../packages/toolcraft-design/src/dashboard/dashboard.js";
import { createRunQueue } from "../../../packages/agent-harness-tools/src/run-queue.js";
import { summarizeToolAction } from "../../../packages/agent-spawn/src/acp/tool-summary.js";
import { adaptCodex } from "../../../packages/agent-spawn/src/adapters/codex.js";
import { streamAcpEventsToDashboard } from "../../../packages/agent-spawn/src/acp/dashboard-stream.js";
import type { DashboardRunState, DashboardTask } from "../../../packages/toolcraft-design/src/dashboard/types.js";

// Interactive simulation only. No agents, credentials, network, or repository writes.
// Esc enters browse mode; r completes one simulated phase/step. q exits.
const regression = process.argv.includes("regression");
const longQueue = process.argv.includes("long-queue");
const validationRace = process.argv.includes("validation-race");
const acknowledgementRace = process.argv.includes("ack-transition");
const queue = createRunQueue({ plans: validationRace ? ["docs/plans/docx-release.md"] : [
  "docs/plans/docx-release.md", "docs/plans/docx-typescript-safe-bash.md"
], ...(longQueue ? { afterEachPlan: Array.from({ length: 25 }, (_, index) => `Follow-up ${index + 1}`) } : {}) });
const abort = new AbortController();
const started = Date.now();
let advance: (() => void) | undefined;
let tasks: DashboardTask[] = [];
let phase = "Setup";
let activity = "Read validation.ts";
let activeTaskId: string | undefined;
let activeStep: string | undefined;
let completed = false;
let tokens = 0;
let outputId = 0;
let burstTimer: ReturnType<typeof setInterval> | undefined;
let burstSequence = 0;
let finishValidation: (() => void) | undefined;

const dashboard = createDashboard({
  title: "Pipeline",
  appearance: "conversation",
  async onSubmit(input) {
    if (input.kind === "plan") {
      await queue.enqueueValidatedPlan(input.text, async (path) => {
        if (validationRace) await new Promise<void>((resolve) => { finishValidation = resolve; });
        if (path.includes("missing")) throw new Error("Plan file was not found");
        return path;
      });
    } else {
      queue.enqueueMessage(input.text, input.afterPlanId);
      if (acknowledgementRace) await new Promise<void>((resolve) => { finishValidation = resolve; });
    }
  }
});

function sync(): void {
  const snapshot = queue.getSnapshot();
  const run: DashboardRunState = {
    agent: "codex", model: "simulation", cwd: "/workspace/poe-setup-scripts",
    phase, activity, activeTaskId, activeStep,
    queue: snapshot.items, activePlanId: snapshot.activePlanId, tasks
  };
  dashboard.updateStats({
    status: snapshot.status === "failed" ? "error" : completed ? "done" : "running",
    iterations: tasks.filter((task) => task.status === "completed").length,
    iterationsLabel: "Tasks", tokensIn: tokens, tokensOut: Math.floor(tokens / 3),
    usageAvailable: tokens > 0, elapsedMs: Date.now() - started + (regression ? 19366000 : 0), run
  });
}

async function next(): Promise<void> {
  if (abort.signal.aborted) return;
  await new Promise<void>((resolve) => { advance = resolve; });
  advance = undefined;
}

const timer = setInterval(sync, 1000);
const shutdown = (): void => {
  abort.abort();
  advance?.();
  clearInterval(timer);
  clearInterval(burstTimer);
  const performance = dashboard.getPerformance();
  dashboard.destroy();
  process.stdout.write(`Render performance: ${JSON.stringify(performance)}\n`);
};
dashboard.onCommand((command) => {
  if (command === "retry") advance?.();
  if (command === "quit" || command === "forceQuit") shutdown();
});
if (process.argv.includes("burst")) {
  burstTimer = setInterval(() => {
    const text = "The focused validation checks are passing. I am reviewing document structure, package exports, and round-trip fidelity.\n\n";
    dashboard.appendOutput({ id: "streaming-progress", kind: "info", role: "agent", ts: Date.now(), text: text.repeat(130) + `Streaming update ${++burstSequence}` });
  }, 16);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
process.on("SIGUSR1", () => advance?.());
process.on("SIGUSR2", () => finishValidation?.());
queue.onChange(sync);
dashboard.start();
dashboard.appendOutput({ kind: "info", role: "agent", ts: Date.now(), text:
  "Simulation ready. Press Esc, then r to complete one phase or step. Type i to return to the message input. Queued work uses the real queue and dashboard." });

await queue.run({
  signal: abort.signal,
  async execute(item) {
    if (item.kind === "message") {
      if (longQueue && item.text !== "Follow-up 18") return "completed";
      phase = "Follow-up";
      activity = "Reviewing your request";
      activeTaskId = undefined;
      activeStep = undefined;
      dashboard.appendOutput({ kind: "info", role: "user", text: item.text, ts: Date.now() });
      sync();
      await next();
      dashboard.appendOutput({ kind: "success", role: "agent", text: `Finished: ${item.text}`, ts: Date.now() });
      return "completed";
    }
    if (validationRace || acknowledgementRace) {
      phase = "Teardown";
      activity = "Review release checks";
      dashboard.appendOutput({ role: "agent", kind: "info", ts: Date.now(), text:
        acknowledgementRace ? `Simulation PID ${process.pid}. Queue a message; SIGUSR1 finishes current work and SIGUSR2 acknowledges the submission.`
          : `Simulation PID ${process.pid}. Submit a plan; SIGUSR1 finishes this plan and SIGUSR2 finishes validation.` });
      sync();
      await next();
      return "completed";
    }
    tasks = Array.from({ length: regression ? 30 : 3 }, (_, index) => ({
      id: `task-${index + 1}`,
      title: ["Define the public API", "Implement package exports", "Verify round-trip fidelity",
        "Validate document relationships", "Check XML namespaces", "Handle ZIP descriptors", "Cover ZIP64 member payloads",
        "Preserve document formatting", "Verify TypeScript declarations", "Review release checks"][index] ?? `Release check ${index + 1}`,
      status: regression && index < 7 ? "completed" : "pending",
      steps: ["implement", "verify"].map((name) => ({ name, status: regression && index < 7 ? "completed" : "pending" }))
    }));
    if (longQueue) {
      tasks.forEach((task) => {
        task.status = "completed";
        task.steps?.forEach((step) => { step.status = "completed"; });
      });
      return "completed";
    }
    phase = "Setup";
    activity = "Read validation.ts";
    activeTaskId = undefined;
    activeStep = undefined;
    sync();
    dashboard.appendOutput({ kind: "info", role: "agent", ts: Date.now(), text:
      "The ZIP64 member checks are passing. I’m inspecting the document validation paths before starting the remaining tasks." });
    if (process.argv.includes("actions")) {
      const commands = [
        "cat package.json", "head -75 packages/docx/src/run-format-command.test.ts",
        "sed -n '97,149p' packages/docx/tests/assertions.ts", "rg --files packages/docx/src",
        "rg -n 'serialize|xml' packages/docx/src/xml-element-view.ts | head -75",
        "cat packages/docx/src/validation.ts", "git grep TODO packages/docx/src",
        "sed -n '1,$p' packages/docx/src/xml-element-view.ts",
        "npm test --workspace=docx > out/tests.log 2>&1",
        "sed -f scripts/check.sed packages/docx/src/validation.ts",
        "cat package.json && npm test",
        "rg --regexp TODO --regexp FIXME packages/docx/src",
        "rg --file patterns.txt packages/docx/src"
      ];
      for (const command of commands) {
        const summary = summarizeToolAction({ kind: "exec", title: command });
        dashboard.appendOutput({ kind: "success", role: "action", text: summary.label, detail: summary.detail, ts: Date.now() });
      }
    }
    if (process.argv.includes("large-action")) {
      const command = `python3 - <<'PY'\n${"print('simulated payload')\n".repeat(10_000)}PY`;
      const summary = summarizeToolAction({ kind: "exec", title: command });
      activity = summary.label;
      dashboard.appendOutput({ kind: "tool", role: "action", text: summary.label, detail: summary.detail, ts: Date.now() });
      sync();
    }
    if (process.argv.includes("checklist")) {
      await streamAcpEventsToDashboard({
        events: adaptCodex((async function* () {
          const titles = ["Inspect ZIP64 member boundaries", "Check document relationships", "Review content types", "Verify namespace handling",
            "Preserve paragraph formatting", "Check public exports", "Review TypeScript declarations", "Run focused tests"];
          for (const [stage, completed] of [0, 6, 8].entries()) {
            yield JSON.stringify({ type: ["item.started", "item.updated", "item.completed"][stage], item: {
              id: "agent-checklist", type: "todo_list", items: titles.map((text, index) => ({ text, completed: index < completed }))
            } });
            if (stage < 2) await next();
          }
        })()),
        signal: abort.signal, onOutput: dashboard.appendOutput
      });
    }
    await next();
    for (const task of tasks.filter((task) => task.status !== "completed")) {
      if (abort.signal.aborted) return "cancelled";
      activeTaskId = task.id;
      task.status = "running";
      for (const step of task.steps!) {
        phase = task.title;
        activeStep = step.name;
        step.status = "running";
        activity = step.name === "implement" ? "Read run-format-command.test.ts" : "Run npm test --workspace=docx";
        const id = `action-${++outputId}`;
        dashboard.appendOutput({ id, kind: "tool", role: "action", text: activity,
          detail: `/bin/zsh -lc '${step.name === "implement" ? "sed -n 1,120p packages/docx/src/run-format-command.test.ts" : "npm test --workspace=docx"}'`, ts: Date.now() });
        sync();
        await next();
        if (abort.signal.aborted) return "cancelled";
        step.status = "completed";
        tokens += 1300;
        dashboard.appendOutput({ id, kind: "success", role: "action", text: `${activity} · done`, ts: Date.now() });
      }
      task.status = "completed";
      dashboard.appendOutput({ kind: "info", role: "agent", text: `${task.title} is complete. The focused checks pass.`, ts: Date.now() });
    }
    phase = "Teardown";
    activity = "Review release summary";
    activeTaskId = undefined;
    activeStep = undefined;
    sync();
    await next();
    return item.path.includes("fail") ? "failed" : "completed";
  }
});
completed = true;
phase = "Sequence complete";
activity = "";
sync();
