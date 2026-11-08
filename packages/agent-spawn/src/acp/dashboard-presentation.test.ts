import { describe, expect, it, vi } from "vitest";
import { streamAcpEventsToDashboard } from "./dashboard-stream.js";

describe("structured dashboard activity", () => {
  it("updates an agent checklist in place without replacing a running action", async () => {
    const onOutput = vi.fn();
    const onActivity = vi.fn();
    await streamAcpEventsToDashboard({
      events: (async function* () {
        yield { event: "tool_start", id: "plan", kind: "exec", title: "npm test" };
        yield { event: "plan", id: "plan", entries: [{ content: "Run tests", status: "pending", priority: "medium" }] };
        yield { event: "plan", id: "plan", entries: [{ content: "Run tests", status: "completed", priority: "medium" }] };
      })(), onOutput, onActivity
    });
    expect(onOutput).toHaveBeenCalledTimes(3);
    expect(onOutput.mock.calls[1]?.[0]).toMatchObject({ role: "plan", kind: "status", text: "Agent checklist · 0/1\n  ○ Run tests" });
    expect(onOutput.mock.calls[2]?.[0]).toMatchObject({ role: "plan", kind: "status", text: "Agent checklist · 1/1\n  ✓ Run tests" });
    expect(onOutput.mock.calls[1]?.[0].id).toBe(onOutput.mock.calls[2]?.[0].id);
    expect(onOutput.mock.calls[1]?.[0].id).not.toBe(onOutput.mock.calls[0]?.[0].id);
    expect(onActivity).toHaveBeenLastCalledWith("Run npm test");
  });

  it("gives each spawned agent its own checklist and displays explicit clearing", async () => {
    const onOutput = vi.fn();
    for (let run = 0; run < 2; run++) {
      await streamAcpEventsToDashboard({
        events: (async function* () { yield { event: "plan", entries: [] }; })(), onOutput
      });
    }
    expect(onOutput).toHaveBeenCalledTimes(2);
    expect(onOutput.mock.calls[0]?.[0].id).not.toBe(onOutput.mock.calls[1]?.[0].id);
    expect(onOutput.mock.calls[1]?.[0].text).toBe("Agent checklist cleared");
  });

  it("keeps a running tool visible when the agent adds a progress message", async () => {
    const onActivity = vi.fn();
    await streamAcpEventsToDashboard({
      events: (async function* () {
        yield { event: "tool_start", id: "test", kind: "exec", title: "npm test" };
        yield { event: "agent_message", text: "The test run is still in progress." };
      })(), onOutput: vi.fn(), onActivity
    });
    expect(onActivity).toHaveBeenLastCalledWith("Run npm test");
  });

  it("updates a concise tool action in place and keeps full command details secondary", async () => {
    const onOutput = vi.fn();
    const onActivity = vi.fn();
    await streamAcpEventsToDashboard({
      events: (async function* () {
        yield { event: "tool_start", id: "read", kind: "exec", title: "/bin/zsh -lc 'cat src/validation.ts'" };
        yield { event: "tool_complete", id: "read", kind: "exec", path: "long tool output" };
      })(), onOutput, onActivity
    });
    expect(onOutput.mock.calls[0]?.[0]).toMatchObject({ kind: "tool", role: "action", text: "Read src/validation.ts" });
    expect(onOutput.mock.calls[1]?.[0]).toMatchObject({ kind: "success", role: "action", text: "Read src/validation.ts" });
    expect(onOutput.mock.calls[0]?.[0].id).toBe(onOutput.mock.calls[1]?.[0].id);
    expect(onOutput.mock.calls[1]?.[0].detail).toContain("/bin/zsh");
    expect(onActivity).toHaveBeenCalledWith("Read src/validation.ts");
  });

  it("keeps messages as prose and emits usage as data instead of a transcript entry", async () => {
    const onOutput = vi.fn();
    const onUsage = vi.fn();
    await streamAcpEventsToDashboard({
      events: (async function* () {
        yield { event: "agent_message", text: "The checks pass.\n\n" };
        yield { event: "agent_message", text: "I’m reviewing the remaining work." };
        yield { event: "usage", inputTokens: 120, outputTokens: 45 };
      })(), onOutput, onUsage
    });
    const final = onOutput.mock.calls.at(-1)?.[0];
    expect(final).toMatchObject({ role: "agent", text: "The checks pass.\n\nI’m reviewing the remaining work." });
    expect(final.text).not.toContain("agent:");
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 120, outputTokens: 45 }));
    expect(onOutput.mock.calls.every(([item]) => item.role === "agent")).toBe(true);
  });

  it("distinguishes failed and cancelled tools from successful completions", async () => {
    const onOutput = vi.fn();
    await streamAcpEventsToDashboard({
      events: (async function* () {
        yield { event: "tool_start", id: "test", kind: "exec", title: "npm test" };
        yield { event: "tool_complete", id: "test", kind: "exec", path: "tests failed", status: "failed" };
        yield { event: "tool_start", id: "build", kind: "exec", title: "npm run build" };
        yield { event: "tool_complete", id: "build", kind: "exec", path: "", status: "cancelled" };
      })(), onOutput
    });
    expect(onOutput.mock.calls[1]?.[0]).toMatchObject({ kind: "error", text: "Run npm test · failed" });
    expect(onOutput.mock.calls[3]?.[0]).toMatchObject({ kind: "status", text: "Run npm run build · cancelled" });
  });

  it("does not collide tool IDs between separate agents", async () => {
    const onOutput = vi.fn();
    for (let run = 0; run < 2; run++) {
      await streamAcpEventsToDashboard({
        events: (async function* () { yield { event: "tool_start", id: "same", kind: "read", title: "src/app.ts" }; })(),
        onOutput
      });
    }
    expect(onOutput.mock.calls[0]?.[0].id).not.toBe(onOutput.mock.calls[1]?.[0].id);
  });
});
