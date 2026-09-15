#!/usr/bin/env node
// External application fixture. Execute QA from docs/plans/qa/pipeline-dashboard-qa.md.
// Put a wrapper named codex on the isolated session PATH; no real agent or network is used.
const scenario = process.env.PIPELINE_FAKE_SCENARIO ?? "completed";
const emit = (event) => process.stdout.write(JSON.stringify(event) + "\n");
emit({ type: "thread.started", thread_id: "fake-pipeline-thread" });
emit({
  type: "item.started",
  item: { id: "inspect", type: "command_execution", command: "fake inspect workspace" }
});
emit({
  type: "item.completed",
  item: {
    id: "message",
    type: "agent_message",
    text: `Fake external agent streaming\nPID=${process.pid}\n`
  }
});
let count = 0;
const timer = setInterval(() => {
  const text = scenario === "oversized"
    ? "output word ".repeat(1000)
    : scenario === "unicode"
      ? `解析中 · 界界 · café · 👩‍💻 · é · response ${count}\n`
      : `Fake external response ${count}\n`;
  emit({ type: "item.completed", item: { id: `message-${count}`, type: "agent_message", text } });
  count += 1;
  if (scenario === "cancelled" || scenario === "burst" || count < 15) return;
  clearInterval(timer);
  if (scenario === "failed") {
    emit({ type: "turn.failed", error: { message: "Fake external execution failed" } });
    process.exitCode = 1;
  } else {
    emit({ type: "item.completed", item: { id: "latest", type: "agent_message", text: "LATEST RESULT\n" } });
    emit({ type: "turn.completed", usage: { input_tokens: 120, output_tokens: 45, cached_input_tokens: 10 } });
  }
}, scenario === "burst" ? 10 : 100);
process.on("SIGTERM", () => {
  clearInterval(timer);
  process.stderr.write("FAKE_CHILD_TERMINATED\n");
  process.exit(143);
});
