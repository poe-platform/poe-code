import { openTaskList, type TaskListFs } from "@poe-code/task-list";
import { createFsFromVolume, Volume } from "memfs";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { S } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import { runCLI } from "./cli.js";
import { createMCPServer } from "./mcp.js";
import { createHumanInLoop } from "./human-in-loop/index.js";
import { enqueueApproval } from "./human-in-loop/approval-tasks.js";
import { approvalStateMachine } from "./human-in-loop/state-machine.js";

const previousExitCode = process.exitCode;
afterEach(() => { process.exitCode = previousExitCode; });

it("round-trips the MCP approval tracking hint through the generated CLI", async () => {
  process.exitCode = 0;
  const taskList = await openTaskList({
    type: "yaml-file",
    path: "/audit/approvals.yaml",
    create: true,
    fs: createFsFromVolume(new Volume()).promises as unknown as TaskListFs,
    stateMachine: approvalStateMachine
  });
  const { pending, approvalId } = await enqueueApproval({
    tasks: taskList.list("approvals"),
    payload: { commandPath: "deploy", params: {}, message: "Deploy the sample?" }
  });
  const provider = { id: "test", requestApproval: vi.fn() };
  const runtime = createHumanInLoop({ provider, taskList });
  const root = defineGroup({
    name: "toolcraft",
    children: [defineCommand({ name: "deploy", scope: ["cli", "mcp"], params: S.Object({}), handler: () => pending })]
  });
  const session = createMCPServer(root, { name: "audit", version: "1", errorReports: false }).createMessageSession();
  onTestFinished(() => session.close());
  await session.handleMessage("initialize", {
    protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" }
  });
  await session.handleMessage("notifications/initialized");
  const response = await session.handleMessage("tools/call", { name: "toolcraft__deploy", arguments: {} });
  expect(response).toMatchObject({ result: { isError: false, content: [
    { type: "text", text: expect.stringContaining("Track with") },
    { type: "text", text: JSON.stringify(pending) }
  ] } });
  const result = response as { result: { content: Array<{ text: string }> } };
  const trackingCommand = result.result.content[0]!.text.split("`")[1]!;
  const output: string[] = [];
  await runCLI(root, {
    argv: ["node", ...trackingCommand.split(" "), "--output", "json"],
    approvals: true,
    humanInLoop: runtime,
    controls: { output: true },
    errorReports: false,
    outputEmitter: (entry) => output.push(entry)
  });
  expect(process.exitCode).toBe(0);
  expect(JSON.parse(output.join("\n"))).toMatchObject({ id: approvalId, state: "pending" });
  expect(provider.requestApproval).not.toHaveBeenCalled();
  expect(await taskList.list("approvals").get(approvalId)).toMatchObject({ state: "pending" });
});
