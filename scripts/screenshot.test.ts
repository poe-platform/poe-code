import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  rmSync
} from "node:fs";
import process from "node:process";
import { renderTerminalPng } from "terminal-png";
import {
  buildScreenshotName,
  resolveScreenshotTimeoutMs,
  runScreenshot
} from "./screenshot.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn()
}));

vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
  rmSync: vi.fn()
}));

vi.mock("terminal-png", () => ({
  renderTerminalPng: vi.fn()
}));

function createSpawnProcess(options: {
  closeCode?: number;
  error?: Error;
  stdoutData?: string;
  stderrData?: string;
} = {}) {
  const processEvents = new EventEmitter();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();

  setTimeout(() => {
    if (options.stdoutData) {
      stdout.emit("data", Buffer.from(options.stdoutData));
    }

    if (options.stderrData) {
      stderr.emit("data", Buffer.from(options.stderrData));
    }

    if (options.error) {
      processEvents.emit("error", options.error);
      return;
    }

    processEvents.emit("close", options.closeCode ?? 0);
  }, 0);

  return {
    stdout,
    stderr,
    killed: false,
    kill: vi.fn(),
    on: processEvents.on.bind(processEvents)
  };
}

const spawnMock = vi.mocked(spawn);
const mkdirSyncMock = vi.mocked(mkdirSync);
const rmSyncMock = vi.mocked(rmSync);
const renderTerminalPngMock = vi.mocked(renderTerminalPng);

describe("resolveScreenshotTimeoutMs", () => {
  it("uses default when env is missing or invalid", () => {
    expect(resolveScreenshotTimeoutMs({})).toBe(15000);
    expect(resolveScreenshotTimeoutMs({ POE_SCREENSHOT_TIMEOUT_MS: "" })).toBe(15000);
    expect(resolveScreenshotTimeoutMs({ POE_SCREENSHOT_TIMEOUT_MS: "0" })).toBe(15000);
    expect(resolveScreenshotTimeoutMs({ POE_SCREENSHOT_TIMEOUT_MS: "-1" })).toBe(15000);
    expect(resolveScreenshotTimeoutMs({ POE_SCREENSHOT_TIMEOUT_MS: "nope" })).toBe(15000);
  });

  it("uses the provided timeout when valid", () => {
    expect(resolveScreenshotTimeoutMs({ POE_SCREENSHOT_TIMEOUT_MS: "12000" })).toBe(12000);
  });
});

describe("buildScreenshotName", () => {
  it("strips shell punctuation from generated filenames", () => {
    expect(buildScreenshotName(["sh", "-lc", 'printf "oops\\n"; exit 2'])).toBe(
      "sh-lc-printf-oops-n-exit-2"
    );
  });
});

describe("runScreenshot", () => {
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spawnMock.mockReset();
    mkdirSyncMock.mockReset();
    rmSyncMock.mockReset();
    renderTerminalPngMock.mockReset();

    renderTerminalPngMock.mockResolvedValue(Buffer.from("png"));
    stdoutWriteSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
    vi.useRealTimers();
  });

  it("renders the captured ANSI transcript directly to the requested PNG path", async () => {
    spawnMock.mockReturnValue(
      createSpawnProcess({
        stdoutData: "\u001b[32mhelp\u001b[39m\n",
        stderrData: "warning\n"
      }) as never
    );

    await runScreenshot(["--poe-code", "--help"], {
      output: "screenshots/help.png"
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "npm",
      ["run", "dev", "--silent", "--", "--help"],
      expect.objectContaining({
        stdio: ["ignore", "pipe", "pipe"]
      })
    );
    expect(mkdirSyncMock).toHaveBeenCalledWith("screenshots", {
      recursive: true
    });
    expect(renderTerminalPngMock).toHaveBeenCalledWith(
      "% poe-code --help\n\u001b[32mhelp\u001b[39m\nwarning\n",
      {
        output: "screenshots/help.png",
        padding: 20,
        window: true
      }
    );
    expect(stdoutWriteSpy).toHaveBeenCalledWith("screenshots/help.png\n");
    expect(rmSyncMock).not.toHaveBeenCalled();
  });

  it("renders screenshot with captured output on timeout", async () => {
    vi.useFakeTimers();

    const processEvents = new EventEmitter();
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();

    const fakeProcess = {
      stdout,
      stderr,
      killed: false,
      kill: vi.fn(() => {
        fakeProcess.killed = true;
      }),
      on: processEvents.on.bind(processEvents)
    };

    spawnMock.mockReturnValue(fakeProcess as never);

    const stderrWriteSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const promise = runScreenshot(["echo", "slow"], {
      output: "screenshots/slow.png"
    });

    stdout.emit("data", Buffer.from("partial output\n"));

    await vi.advanceTimersByTimeAsync(15000);

    await promise;

    expect(renderTerminalPngMock).toHaveBeenCalledWith(
      expect.stringContaining("partial output"),
      expect.objectContaining({ output: "screenshots/slow.png" })
    );
    expect(stdoutWriteSpy).toHaveBeenCalledWith("screenshots/slow.png\n");
    expect(stderrWriteSpy).toHaveBeenCalledWith(
      expect.stringContaining("Timed out")
    );

    stderrWriteSpy.mockRestore();
  });

  it("renders screenshot and warns when command exits non-zero", async () => {
    spawnMock.mockReturnValue(
      createSpawnProcess({
        closeCode: 2,
        stdoutData: "broken\n"
      }) as never
    );

    const stderrWriteSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    await runScreenshot(["echo", "oops"], {
      output: "screenshots/oops.png"
    });

    expect(renderTerminalPngMock).toHaveBeenCalledWith("% echo oops\nbroken\n", {
      output: "screenshots/oops.png",
      padding: 20,
      window: true
    });
    expect(stdoutWriteSpy).toHaveBeenCalledWith("screenshots/oops.png\n");
    expect(stderrWriteSpy).toHaveBeenCalledWith(
      expect.stringContaining("exited with code 2")
    );

    stderrWriteSpy.mockRestore();
  });
});
