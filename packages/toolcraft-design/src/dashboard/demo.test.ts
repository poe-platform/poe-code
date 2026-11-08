import { afterEach, describe, expect, it, vi } from "vitest";
import { startDashboardDemo } from "./demo.js";
import type { Dashboard } from "./dashboard.js";

type DemoDashboard = Pick<Dashboard, "appendOutput" | "updateStats">;

describe("startDashboardDemo", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("cycles output kinds, increments stats, and marks the session done after 30 seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-14T12:00:00Z"));

    const dashboard: DemoDashboard = {
      appendOutput: vi.fn(),
      updateStats: vi.fn()
    };

    const stopDemo = startDashboardDemo(dashboard, {
      random: () => 0,
      now: () => Date.now()
    });

    expect(dashboard.updateStats).toHaveBeenCalledWith({
      status: "running",
      currentAction: "Connecting to provider"
    });

    await vi.advanceTimersByTimeAsync(2_500);

    expect(dashboard.appendOutput).toHaveBeenCalledTimes(5);
    expect(dashboard.appendOutput).toHaveBeenNthCalledWith(1, {
      kind: "info",
      text: "Analyzing repository state",
      ts: Date.parse("2026-04-14T12:00:00.500Z")
    });
    expect(dashboard.appendOutput).toHaveBeenNthCalledWith(2, {
      kind: "success",
      text: "Generated provider config",
      ts: Date.parse("2026-04-14T12:00:01.000Z")
    });
    expect(dashboard.appendOutput).toHaveBeenNthCalledWith(3, {
      kind: "error",
      text: "Retrying transient network request",
      ts: Date.parse("2026-04-14T12:00:01.500Z")
    });
    expect(dashboard.appendOutput).toHaveBeenNthCalledWith(4, {
      kind: "tool",
      text: "Running npm test -- --runInBand",
      ts: Date.parse("2026-04-14T12:00:02.000Z")
    });
    expect(dashboard.appendOutput).toHaveBeenNthCalledWith(5, {
      kind: "status",
      text: "Waiting for follow-up task",
      ts: Date.parse("2026-04-14T12:00:02.500Z")
    });

    expect(dashboard.updateStats).toHaveBeenNthCalledWith(2, {
      status: "running",
      iterations: 1,
      tokensIn: 137,
      tokensOut: 89,
      elapsedMs: 1_000,
      currentAction: "Planning next step"
    });
    expect(dashboard.updateStats).toHaveBeenNthCalledWith(3, {
      status: "running",
      iterations: 2,
      tokensIn: 274,
      tokensOut: 178,
      elapsedMs: 2_000,
      currentAction: "Executing tool call"
    });

    await vi.advanceTimersByTimeAsync(27_500);

    expect(dashboard.appendOutput).toHaveBeenCalledTimes(60);
    expect(dashboard.appendOutput).toHaveBeenLastCalledWith({
      kind: "status",
      text: "Waiting for follow-up task",
      ts: Date.parse("2026-04-14T12:00:30.000Z")
    });

    expect(dashboard.updateStats).toHaveBeenNthCalledWith(31, {
      status: "running",
      iterations: 30,
      tokensIn: 4_110,
      tokensOut: 2_670,
      elapsedMs: 30_000,
      currentAction: "Preparing final response"
    });
    expect(dashboard.updateStats).toHaveBeenLastCalledWith({
      status: "done",
      iterations: 30,
      tokensIn: 4_110,
      tokensOut: 2_670,
      elapsedMs: 30_000,
      currentAction: "Completed"
    });

    const outputCallsBeforeStop = vi.mocked(dashboard.appendOutput).mock.calls.length;
    const statCallsBeforeStop = vi.mocked(dashboard.updateStats).mock.calls.length;

    await vi.advanceTimersByTimeAsync(2_000);

    expect(dashboard.appendOutput).toHaveBeenCalledTimes(outputCallsBeforeStop);
    expect(dashboard.updateStats).toHaveBeenCalledTimes(statCallsBeforeStop);

    stopDemo();
  });

  it("stops scheduling updates when cleaned up early", async () => {
    vi.useFakeTimers();

    const dashboard: DemoDashboard = {
      appendOutput: vi.fn(),
      updateStats: vi.fn()
    };

    const stopDemo = startDashboardDemo(dashboard, {
      random: () => 0,
      now: () => Date.now()
    });

    await vi.advanceTimersByTimeAsync(1_000);
    stopDemo();

    const outputCalls = vi.mocked(dashboard.appendOutput).mock.calls.length;
    const statCalls = vi.mocked(dashboard.updateStats).mock.calls.length;

    await vi.advanceTimersByTimeAsync(5_000);

    expect(dashboard.appendOutput).toHaveBeenCalledTimes(outputCalls);
    expect(dashboard.updateStats).toHaveBeenCalledTimes(statCalls);
  });
});
