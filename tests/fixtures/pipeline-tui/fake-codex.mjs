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
let timer;
if (scenario === "activity-timeout") {
  process.stderr.write("first attempt warning\u001b]HIDDEN_UNFINISHED_OSC");
  timer = setInterval(() => {}, 1000);
} else if (scenario === "finite-burst" || scenario === "finite-burst-immediate") {
  timer = setTimeout(() => {
    for (let index = 0; index < 60_000; index++) {
      emit({ type: "item.completed", item: { id: `message-${index}`, type: "agent_message", text: `Burst response ${index}\n` } });
    }
    emit({ type: "item.completed", item: { id: "latest", type: "agent_message", text: "LATEST BURST RESULT\n" } });
    timer = setTimeout(() => {
      emit({ type: "turn.completed", usage: { input_tokens: 120, output_tokens: 45, cached_input_tokens: 10 } });
    }, scenario === "finite-burst-immediate" ? 0 : 90_000);
  }, 500);
} else timer = setInterval(() => {
  if (scenario === "tool-burst") {
    for (let index = 0; index < 20; index++) {
      const id = `tool-${count}`;
      const command = `fake noisy tool ${count++}`;
      emit({ type: "item.started", item: { id, type: "command_execution", command } });
      emit({ type: "item.completed", item: { id, type: "command_execution", command, exit_code: 0 } });
    }
    return;
  }
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
}, scenario === "burst" ? 10 : scenario === "tool-burst" ? 50 : 100);
process.on("SIGTERM", () => {
  clearInterval(timer);
  process.stderr.write("FAKE_CHILD_TERMINATED\n");
  process.exit(143);
});
