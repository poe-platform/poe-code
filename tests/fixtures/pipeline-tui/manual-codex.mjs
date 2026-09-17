#!/usr/bin/env node
// Simulated external agent for the Markdown terminal-pilot walkthrough.
// SIGUSR1 completes this invocation; SIGUSR2 simulates a failed command. No commands are executed.
const emit = (event) => process.stdout.write(JSON.stringify(event) + "\n");
const args = process.argv.slice(2);
const resumeIndex = args.indexOf("resume");
const threadId = resumeIndex >= 0 ? args[resumeIndex + 1] : `simulation-${process.pid}`;
emit({ type: "thread.started", thread_id: threadId });
const checklist = ["Inspect document validation", "Verify package exports", "Run focused checks"];
emit({ type: "item.started", item: { id: "checklist", type: "todo_list", items: checklist.map((text) => ({ text, completed: false })) } });
const command = "/bin/zsh -lc 'sed -n 97,149p packages/docx/src/validation.ts'";
emit({ type: "item.started", item: { id: "read", type: "command_execution", command, status: "in_progress" } });
emit({ type: "item.completed", item: { id: "read", type: "command_execution", command, status: "completed", exit_code: 0 } });
emit({ type: "item.updated", item: { id: "checklist", type: "todo_list", items: checklist.map((text, index) => ({ text, completed: index < 2 })) } });
emit({ type: "item.completed", item: { id: "message", type: "agent_message", text: "The public API checks pass. I’m verifying document round trips and the TypeScript exports before moving to the next task.\n" } });
emit({ type: "item.started", item: { id: "test", type: "command_execution", command: "npm test --workspace=docx", status: "in_progress" } });
emit({ type: "item.completed", item: { id: "control", type: "agent_message", text: `Simulation paused · PID ${process.pid}. Send SIGUSR1 to finish this agent run.\n` } });
const queuedPrompt = args.find((arg) => arg.startsWith("Follow-up after completing "));
if (queuedPrompt) emit({ type: "item.completed", item: { id: "queued-prompt", type: "agent_message", text: queuedPrompt + "\n" } });
const timer = setInterval(() => {}, 1000);
process.on("SIGUSR1", () => {
  clearInterval(timer);
  emit({ type: "item.completed", item: { id: "test", type: "command_execution", command: "npm test --workspace=docx", status: "completed", exit_code: 0 } });
  emit({ type: "item.completed", item: { id: "checklist", type: "todo_list", items: checklist.map((text) => ({ text, completed: true })) } });
  const workflowServer = args.some((arg) => arg.includes("owner-workflow")) ? "owner-workflow"
    : args.some((arg) => arg.includes("superintendent-tools")) ? "superintendent-tools" : undefined;
  if (workflowServer) {
    emit({ type: "item.completed", item: {
      id: "workflow", type: "mcp_tool_call", server: workflowServer, tool: "workflow_transition", status: "completed",
      arguments: workflowServer === "owner-workflow" ? { action: "approve_completion" }
        : { action: "request_review", summary: "Simulated implementation is ready for owner review." }
    } });
  }
  emit({ type: "item.completed", item: { id: "done", type: "agent_message", text: "Verification passed. This run is complete.\n" } });
  process.stdout.write(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1300, output_tokens: 350, cached_input_tokens: 200 } }) + "\n", () => process.exit(0));
});
process.on("SIGTERM", () => { clearInterval(timer); process.exit(143); });
process.on("SIGUSR2", () => {
  clearInterval(timer);
  emit({ type: "item.completed", item: { id: "test", type: "command_execution", command: "npm test --workspace=docx", status: "failed", exit_code: 1 } });
  process.stdout.write(JSON.stringify({ type: "turn.failed", error: { message: "Simulated focused test failure" } }) + "\n", () => process.exit(1));
});
