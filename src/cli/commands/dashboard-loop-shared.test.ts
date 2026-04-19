import { afterEach, describe, expect, it, vi } from "vitest";
import { withOutputFormat } from "@poe-code/design-system";

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
});
