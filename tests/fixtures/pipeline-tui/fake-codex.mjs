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
} else if (scenario === "finite-burst" || scenario === "finite-burst-immediate" || scenario === "deep-cjk") {
  timer = setTimeout(() => {
    const messageCount = scenario === "deep-cjk" ? 512 : 60_000;
    for (let index = 0; index < messageCount; index++) {
      if (scenario === "deep-cjk") {
        emit({ type: "item.started", item: { id: `boundary-${index}`, type: "command_execution", command: `fake CJK block ${index}` } });
      }
      const text = scenario === "deep-cjk" ? "界".repeat(16_384) + ` row${index}\n` : `Burst response ${index}\n`;
      emit({ type: "item.completed", item: { id: `message-${index}`, type: "agent_message", text } });
    }
    emit({ type: "item.completed", item: { id: "latest", type: "agent_message", text: "LATEST BURST RESULT\n" } });
    timer = setTimeout(() => {
      emit({ type: "turn.completed", usage: { input_tokens: 120, output_tokens: 45, cached_input_tokens: 10 } });
    }, scenario === "finite-burst-immediate" ? 0 : scenario === "deep-cjk" ? 300_000 : 90_000);
  }, scenario === "deep-cjk" ? 3000 : 500);
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
  if (scenario === "usage-before-cancellation" && count === 1) {
    emit({ type: "turn.completed", usage: { input_tokens: 120, output_tokens: 45, cached_input_tokens: 10 } });
  }
  if (scenario === "cancelled" || scenario === "usage-before-cancellation" || scenario === "burst" || count < 15) return;
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
