import { createDashboard } from "../dashboard.js";
import type { OutputItemKind } from "../types.js";

// Fake output only: no agent, credentials, repository writes, or network requests.
const scenario = process.argv[2] ?? "streaming";
const dashboard = createDashboard({
  title: `Pipeline · ${scenario}`,
  statsTitle: "Run",
  rightPaneWidth: 32,
  hints: [
    { key: "q", label: "Quit" },
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
dashboard.updateStats({
  status: "running",
  iterationsLabel: "Tasks",
  iterations: 1,
  tokensIn: 24000,
  tokensOut: 7000,
  elapsedMs: 65000,
  currentAction: "Improve streaming output (implement)"
});
append("info", "Config · codex · model-example · docs/plans/fake-pipeline.md");
append("status", "Task 2/8 · Improve streaming output (implement)");
if (scenario === "empty") {
  dashboard.updateStats({ status: "done", iterations: 0, currentAction: "Nothing to run" });
  append("info", "All tasks are already complete.");
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
      () => append("info", `Streaming response ${count} · working on task 2/8`),
      500
    );
  }
}
// Keep terminal state visible until QA sends q, including completed/error scenarios.
if (timer === undefined) timer = setInterval(() => {}, 1000);
