import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveOutputFormatMock = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/design-system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/design-system")>();
  return {
    ...actual,
    resolveOutputFormat: resolveOutputFormatMock
  };
});

import {
  createDashboardLineBuffer,
  formatDashboardDuration,
  formatDashboardTimestamp,
  shouldUseInteractiveDashboard
} from "./dashboard-loop-shared.js";

describe("dashboard loop shared helpers", () => {
  beforeEach(() => {
    resolveOutputFormatMock.mockReset();
    resolveOutputFormatMock.mockReturnValue("terminal");
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

    expect(shouldUseInteractiveDashboard(true, io)).toBe(true);
    expect(shouldUseInteractiveDashboard(false, io)).toBe(false);

    resolveOutputFormatMock.mockReturnValue("json");
    expect(shouldUseInteractiveDashboard(true, io)).toBe(false);

    resolveOutputFormatMock.mockReturnValue("terminal");
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
});
