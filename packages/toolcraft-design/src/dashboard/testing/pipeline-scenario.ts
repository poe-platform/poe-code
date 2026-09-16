import { createDashboard } from "../dashboard.js";
import { createDashboardLineBuffer } from "../line-buffer.js";
import type { OutputItemKind } from "../types.js";

// Fake output only: no agent, credentials, repository writes, or network requests.
const scenario = process.argv[2] ?? "streaming";
const labelControl = scenario === "label-controls" ? "\u001b]52;c;" + "HIDDEN_".repeat(100) + "\u0007" : "";
const dashboard = createDashboard({
  title: scenario === "unicode-title" ? "Pipeline · 界界 · 👩‍💻 · é · ".repeat(3) : `Pipeline · ${scenario}${labelControl}`,
  statsTitle: scenario === "unicode-title" ? "Run · 界界 · 👩‍💻 · é" : `Run${labelControl}`,
  rightPaneWidth: 44,
  hints: [
    { key: "q", label: `Quit${labelControl}` },
    { key: "↑↓", label: "Scroll" },
    { key: "F", label: "Follow" }
  ]
});
let count = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const append = (kind: OutputItemKind, text: string): void => {
  dashboard.appendOutput({ kind, text, ts: count++ });
};
const shutdown = (): void => {
  clearInterval(timer);
  dashboard.destroy();
};
dashboard.onCommand((command) => {
  if (command === "quit" || command === "forceQuit") shutdown();
});
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
dashboard.start();
if (scenario !== "empty") dashboard.updateStats({
  status: "running",
  iterationsLabel: `Tasks${labelControl}`,
  iterations: scenario === "resumed" || scenario === "queue" ? 68 : 1,
  iterationsTotal: scenario === "resumed" || scenario === "queue" ? 90 : 8,
  context: scenario === "queue" ? ["Plan 1/3: docs/plans/improve-pipeline-task-counts-and-restart-progress.md", "Next 2/3: docs/plans/agent-conversation-recovery.md", "Next 3/3: docs/plans/界界-unicode-long-plan-title.md"] : ["Plan 1/1: docs/plans/improve-pipeline-task-counts-and-restart-progress.md"],
  tokensIn: 24000,
  tokensOut: 7000,
  elapsedMs: 65000,
  currentAction: scenario === "resumed" || scenario === "queue" ? "Task 69/90 · Improve persisted pipeline progress · implement · step 1/2" : "Improve streaming output (implement)"
});
append("info", "Config · codex · model-example · docs/plans/fake-pipeline.md");
if (scenario !== "empty") append("status", scenario === "resumed" || scenario === "queue" ? "Task 69/90 · Improve persisted pipeline progress (implement)" : "Task 2/8 · Improve streaming output (implement)");
if (scenario === "empty") {
  dashboard.updateStats({
    status: "done",
    iterationsLabel: "Tasks",
    iterations: 0,
    tokensIn: 0,
    tokensOut: 0,
    elapsedMs: 0,
    currentAction: "Nothing to run"
  });
  append("info", "All tasks are already complete.");
} else if (scenario === "oversized") {
  append("tool", "output word ".repeat(50000) + "LATEST RESULT");
} else if (scenario === "newline-free") {
  const output = createDashboardLineBuffer((line) => append("tool", line));
  for (let index = 0; index < 1000; index += 1) output.push("output word ".repeat(100));
  output.push("LATEST RESULT");
  output.flush();
} else if (scenario === "execution-error") {
  append("error", "Fake execution threw before producing a task result");
  dashboard.updateStats({ status: "error", currentAction: undefined });
} else if (scenario === "failure") {
  append("tool", "npm test · checking streaming output");
  append(
    "error",
    "Tool exited with code 1\nExpected task result, received empty output\nRetry after correcting the task."
  );
  dashboard.updateStats({ status: "error", currentAction: "Task 2/8 failed (implement)" });
} else if (scenario === "unicode") {
  append("info", "解析中 · 界界 · café · 👩‍💻 · é");
  append(
    "tool",
    "\u001b[31merror\u001b[0m normal \u001b[1;32msuccess\u001b[0m\nindented\tcolumn\nprogress 10%\rprogress 100%"
  );
  append("success", "Unicode and ANSI fixture ready");
} else if (scenario === "label-controls") {
  append("success", "Label control fixture ready");
} else if (scenario === "unicode-title") {
  append("success", "Unicode heading fixture ready");
} else if (scenario === "cursor-controls") {
  append("tool", "\u001b[32m界界\rA\u001b[0m\n😀\bX\n👩‍💻\bX\né\bX\na\tB\rX");
  append("tool", "\u001b]52;c;HIDDEN_OSC_PAYLOAD\u0007Visible OSC result");
  append("tool", "\u001bP HIDDEN_DCS_PAYLOAD\u001b\\Visible DCS result");
  append("tool", "\u001b[2J\u001b[1;1HFrame preserved");
  append("tool", "left\u007fright · \u009b2JC1 frame preserved");
  append("tool", "\u009dHIDDEN_C1_OSC\u009cVisible C1 OSC result");
  append("tool", "\u0090HIDDEN_FIRST\u0007HIDDEN_SECOND\u009cVisible C1 DCS result");
  append("tool", "\u001bP" + "HIDDEN_LONG_".repeat(4_000) + "\u001b\\Visible long DCS result");
  const output = createDashboardLineBuffer((line) => append("tool", line));
  output.push("\u001b]HIDDEN_FIRST\n");
  output.push("HIDDEN_SECOND\nHIDDEN_THIRD\u001b");
  output.push("\\Visible multiline OSC result\n");
  append("tool", "\u001b[" + "0;".repeat(20_000) + "mVisible long CSI result");
  append("tool", "\u001bPHIDDEN_CANCELLED_DCS\u0018Visible cancelled DCS result");
  append("tool", "\u001b]HIDDEN_CANCELLED_OSC\u001aVisible cancelled OSC result");
  append("tool", "\u001b[0;\u001b[32mVisible restarted CSI result\u001b[0m");
  append("tool", "Tab preservation fixture\nABCDEF\r\tX");
  append("tool", "\u001b[31mABCDEF\u001b[0m\r\tX\n界界AB\r\tX");
  append("tool", "Erase-line fixture\nprogress 100%\rprogress 50%\u001b[K\nABCDE\rXX\u001b[1K");
  append("tool", "界界\b\u001b[KX\n界界AB\rXX\u001b[1K");
  append("success", "Cursor control fixture ready");
} else {
  for (let index = 0; index < 200; index += 1) {
    append("tool", `[implement] Inspecting source file ${index} and running focused checks`);
  }
  if (scenario === "burst") {
    timer = setInterval(() => {
      for (let index = 0; index < 100; index += 1) append("tool", `burst output ${count}`);
    }, 100);
  } else {
    timer = setInterval(
      () => append("info", `Streaming response ${count} · working on the current task`),
      500
    );
  }
}
// Keep terminal state visible until QA sends q, including completed/error scenarios.
if (timer === undefined) timer = setInterval(() => {}, 1000);
