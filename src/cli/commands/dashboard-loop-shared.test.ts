import { afterEach, describe, expect, it, vi } from "vitest";
import { withOutputFormat } from "toolcraft-design";

import {
  createDashboardLineBuffer,
  formatDashboardDuration,
  formatDashboardTimestamp,
  registerDashboardQuitCommands,
  shouldUseInteractiveDashboard
} from "./dashboard-loop-shared.js";

describe("dashboard loop shared helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("formats dashboard durations in seconds and minutes", () => {
    expect(formatDashboardDuration(59_000)).toBe("59s");
    expect(formatDashboardDuration(61_000)).toBe("1m 1s");
  });

  it("formats dashboard timestamps as hh:mm:ss", () => {
    const timestamp = new Date(2026, 0, 2, 5, 6, 7).getTime();

    expect(formatDashboardTimestamp(timestamp)).toBe("[05:06:07]");
  });

  it("buffers partial chunks until newline or flush", () => {
    const lines: string[] = [];
    const buffer = createDashboardLineBuffer((line) => {
      lines.push(line);
    });

    buffer.push("alpha");
    expect(lines).toEqual([]);

    buffer.push("\r\nbeta\ncharlie");
    expect(lines).toEqual(["alpha", "beta"]);

    buffer.flush();
    expect(lines).toEqual(["alpha", "beta", "charlie"]);
  });

  it("bounds pending newline-free output while retaining the latest text", () => {
    const lines: string[] = [];
    const buffer = createDashboardLineBuffer((line) => lines.push(line));
    for (let index = 0; index < 100; index += 1) buffer.push("old output ".repeat(100));
    buffer.push("LATEST RESULT");
    expect(lines).toEqual([]);
    buffer.flush();
    expect(lines).toHaveLength(1);
    expect(lines[0]!.length).toBeLessThanOrEqual(16_384);
    expect(lines[0]).toContain("Output truncated");
    expect(lines[0]!.endsWith("LATEST RESULT")).toBe(true);
    buffer.push("next\r");
    buffer.push("\n");
    expect(lines.at(-1)).toBe("next");
  });

  it("bounds oversized completed lines without losing following lines", () => {
    const lines: string[] = [];
    const buffer = createDashboardLineBuffer((line) => lines.push(line));
    buffer.push("x".repeat(30000) + "END\nnext\n");
    expect(lines[0]!.length).toBeLessThanOrEqual(16_384);
    expect(lines[0]).toContain("Output truncated");
    expect(lines[0]!.endsWith("END")).toBe(true);
    expect(lines[1]).toBe("next");
    buffer.flush();
    expect(lines).toHaveLength(2);
  });

  it("requires --tui, terminal output, and TTY stdin/stdout", () => {
    const io = {
      stdin: { isTTY: true },
      stdout: { isTTY: true }
    };

    withOutputFormat("terminal", () => {
      expect(shouldUseInteractiveDashboard(true, io)).toBe(true);
      expect(shouldUseInteractiveDashboard(false, io)).toBe(false);
      expect(
        shouldUseInteractiveDashboard(true, {
          stdin: { isTTY: false },
          stdout: { isTTY: true }
        })
      ).toBe(false);
      expect(
        shouldUseInteractiveDashboard(true, {
          stdin: { isTTY: true },
          stdout: { isTTY: false }
        })
      ).toBe(false);
    });

    withOutputFormat("json", () => {
      expect(shouldUseInteractiveDashboard(true, io)).toBe(false);
    });
  });

  it("routes quit commands through requestCancellation", () => {
    const commandHandlers: Array<(command: string) => void> = [];
    const requestCancellation = vi.fn();

    registerDashboardQuitCommands({
      abortController: new AbortController(),
      dashboard: {
        onCommand(handler) {
          commandHandlers.push(handler);
        },
        stop: vi.fn(),
        destroy: vi.fn()
      },
      requestCancellation
    });

    commandHandlers[0]?.("quit");

    expect(requestCancellation).toHaveBeenCalledTimes(1);
  });

  it("force quits by aborting, tearing down the dashboard, and exiting 130", () => {
    const commandHandlers: Array<(command: string) => void> = [];
    const abortController = new AbortController();
    const stop = vi.fn();
    const destroy = vi.fn();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    registerDashboardQuitCommands({
      abortController,
      dashboard: {
        onCommand(handler) {
          commandHandlers.push(handler);
        },
        stop,
        destroy
      },
      requestCancellation: vi.fn()
    });

    commandHandlers[0]?.("forceQuit");

    expect(abortController.signal.aborted).toBe(true);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(130);
  });
  it("restores the terminal immediately but waits for run cleanup before force exit", async () => {
    let commandHandler: (command: string) => void = () => {};
    let finishCleanup!: () => void;
    const cleanupComplete = new Promise<void>((resolve) => { finishCleanup = resolve; });
    const abortController = new AbortController();
    const destroy = vi.fn();
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    registerDashboardQuitCommands({
      abortController,
      dashboard: { onCommand(handler) { commandHandler = handler; }, stop: vi.fn(), destroy },
      requestCancellation: vi.fn(),
      cleanupComplete
    });
    commandHandler("forceQuit");
    commandHandler("forceQuit");
    expect(abortController.signal.aborted).toBe(true);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
    finishCleanup();
    await cleanupComplete;
    await Promise.resolve();
    expect(exit).toHaveBeenCalledExactlyOnceWith(130);
  });

});
