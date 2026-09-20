import { describe, expect, it, vi } from "vitest";
import type { dashboard } from "toolcraft-design";
import { createDashboardAgentRunner } from "./dashboard-runner.js";
import type { AcpEvent } from "./types.js";

describe("dashboard agent runner", () => {
  it("preserves autonomous timeout retries when requested by a harness", async () => {
    const spawn = vi.fn()
      .mockImplementationOnce(() => ({ events: (async function* () {})(), result: Promise.reject(Object.assign(new Error("Timed out"), { name: "ActivityTimeoutError" })) }))
      .mockImplementationOnce(() => ({ events: (async function* () {})(), result: Promise.resolve({ stdout: "Recovered", stderr: "", exitCode: 0 }) }));
    const run = createDashboardAgentRunner({ spawn, onOutput: vi.fn(), maxTimeoutRetries: 3 });
    await expect(run({ agent: "codex", prompt: "Work" })).resolves.toMatchObject({ exitCode: 0 });
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("never retries a timeout after cancellation", async () => {
    const controller = new AbortController();
    const error = Object.assign(new Error("Timed out"), { name: "ActivityTimeoutError" });
    const spawn = vi.fn(() => {
      controller.abort();
      return { events: (async function* () {})(), result: Promise.reject(error) };
    });
    const run = createDashboardAgentRunner({ spawn, onOutput: vi.fn(), maxTimeoutRetries: 3 });
    await expect(run({ agent: "codex", prompt: "Work", signal: controller.signal })).rejects.toBe(error);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("forwards the full spawn context and reconciles streamed usage with final totals", async () => {
    const output: dashboard.OutputItem[] = [];
    const usage: Array<{ inputTokens: number; outputTokens: number }> = [];
    const spawn = vi.fn(() => ({
      events: (async function* (): AsyncGenerator<AcpEvent> {
        yield { event: "tool_start", id: "read", kind: "exec", title: "cat src/app.ts" };
        yield { event: "tool_complete", id: "read", kind: "exec", path: "", status: "completed" };
        yield { event: "usage", inputTokens: 100, outputTokens: 20 };
      })(),
      result: Promise.resolve({ stdout: "raw protocol", stderr: "", exitCode: 0, usage: { inputTokens: 125, outputTokens: 25 } })
    }));
    const middleware = vi.fn();
    const run = createDashboardAgentRunner({ spawn, onOutput: (item) => output.push(item), onUsage: (delta) => usage.push(delta), middlewares: [middleware] });
    const controller = new AbortController();
    await run({ agent: "codex", prompt: "Implement", cwd: "/worktree", model: "chosen", mode: "yolo", logFileName: "step.jsonl", skills: ["test"], hooks: { from: "claude" }, mcpServers: {}, signal: controller.signal });
    expect(spawn).toHaveBeenCalledWith("codex", expect.objectContaining({ captureSession: false, prompt: "Implement", cwd: "/worktree", model: "chosen", mode: "yolo", logFileName: "step.jsonl", skills: ["test"], hooks: { from: "claude" }, mcpServers: {}, signal: controller.signal, middlewares: [middleware] }));
    expect(output.map((item) => item.text)).toEqual(["Read src/app.ts", "Read src/app.ts"]);
    expect(usage.reduce((total, item) => total + item.inputTokens, 0)).toBe(125);
    expect(usage.reduce((total, item) => total + item.outputTokens, 0)).toBe(25);
  });

  it("shows plain stdout when there are no ACP events and does not invent usage", async () => {
    const output = vi.fn();
    const onUsage = vi.fn();
    const spawn = vi.fn(() => ({ events: (async function* () {})(), result: Promise.resolve({ stdout: "Working\nDone", stderr: "", exitCode: 0 }) }));
    await createDashboardAgentRunner({ spawn, onOutput: output, onUsage })({ agent: "custom", prompt: "Work", cwd: "/repo" });
    expect(output).toHaveBeenCalledWith(expect.objectContaining({ role: "agent", text: "Working" }));
    expect(output).toHaveBeenCalledWith(expect.objectContaining({ role: "agent", text: "Done" }));
    expect(onUsage).not.toHaveBeenCalled();
  });

  it("clears activity and preserves observed usage when the spawn fails", async () => {
    const error = new Error("Agent disconnected");
    const onActivity = vi.fn();
    const onUsage = vi.fn();
    const spawn = vi.fn(() => ({ events: (async function* (): AsyncGenerator<AcpEvent> { yield { event: "usage", inputTokens: 10, outputTokens: 3 }; })(), result: Promise.reject(error) }));
    await expect(createDashboardAgentRunner({ spawn, onOutput: vi.fn(), onActivity, onUsage })({ agent: "codex", prompt: "Work", cwd: "/repo" })).rejects.toBe(error);
    expect(onActivity).toHaveBeenLastCalledWith(undefined);
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 10, outputTokens: 3 });
  });
});
