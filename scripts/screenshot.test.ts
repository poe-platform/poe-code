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
  buildColorEnv,
  buildSpawnSpec,
  decodeScreenshotKeys,
  resolveScreenshotTarget,
  resolveScreenshotTimeoutMs,
  runScreenshot,
  shouldUsePtyScreenshot,
  usePtyScreenshot
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
    expect(resolveScreenshotTimeoutMs({})).toBe(60000);
    expect(resolveScreenshotTimeoutMs({ POE_SCREENSHOT_TIMEOUT_MS: "" })).toBe(60000);
    expect(resolveScreenshotTimeoutMs({ POE_SCREENSHOT_TIMEOUT_MS: "0" })).toBe(60000);
    expect(resolveScreenshotTimeoutMs({ POE_SCREENSHOT_TIMEOUT_MS: "-1" })).toBe(60000);
    expect(resolveScreenshotTimeoutMs({ POE_SCREENSHOT_TIMEOUT_MS: "nope" })).toBe(60000);
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

describe("buildColorEnv", () => {
  it("forces colored output and silences npm script prelude noise", () => {
    expect(buildColorEnv({ TERM: "screen" })).toMatchObject({
      TERM: "screen",
      FORCE_COLOR: "1",
      CLICOLOR_FORCE: "1",
      POE_NO_SPINNER: "1",
      NPM_CONFIG_LOGLEVEL: "silent"
    });
  });

  it("preserves an explicit npm loglevel override", () => {
    expect(buildColorEnv({ NPM_CONFIG_LOGLEVEL: "verbose" }).NPM_CONFIG_LOGLEVEL).toBe("verbose");
  });
});

describe("decodeScreenshotKeys", () => {
  it("decodes named keys, repeated keys, and literal characters", () => {
    expect(decodeScreenshotKeys("down*2,shift-up,f,tab,enter,space")).toEqual([
      "\u001b[B",
      "\u001b[B",
      "\u001b[1;2A",
      "f",
      "\t",
      "\r",
      " "
    ]);
  });

  it("rejects unknown key names", () => {
    expect(() => decodeScreenshotKeys("missing-key")).toThrow(
      'Unknown screenshot key token "missing-key".'
    );
  });
});

describe("usePtyScreenshot", () => {
  it("uses PTY capture only when explicitly requested", () => {
    expect(usePtyScreenshot({})).toBe(false);
    expect(usePtyScreenshot({ POE_SCREENSHOT_PTY: "0" })).toBe(false);
    expect(usePtyScreenshot({ POE_SCREENSHOT_PTY: "1" })).toBe(true);
  });
});

describe("shouldUsePtyScreenshot", () => {
  it("uses PTY capture for interactive poe-code screenshots", () => {
    expect(shouldUsePtyScreenshot(resolveScreenshotTarget(["--poe-code", "traces"]), {})).toBe(true);
  });

  it("keeps non-interactive poe-code screenshots on transcript capture", () => {
    expect(shouldUsePtyScreenshot(resolveScreenshotTarget(["--poe-code", "traces", "--yes"]), {}))
      .toBe(false);
    expect(shouldUsePtyScreenshot(resolveScreenshotTarget(["--poe-code", "traces", "--help"]), {}))
      .toBe(false);
  });

  it("honors the explicit PTY environment override", () => {
    expect(shouldUsePtyScreenshot(resolveScreenshotTarget(["echo", "hello"]), { POE_SCREENSHOT_PTY: "1" }))
      .toBe(true);
  });
});

describe("buildSpawnSpec", () => {
  it("runs poe-code screenshots without re-triggering predev during capture", () => {
    const target = resolveScreenshotTarget(["--poe-code", "--help"]);

    expect(buildSpawnSpec(target, {}, "/tmp/force-tty.cjs")).toMatchObject({
      command: "npm",
      args: ["run", "--silent", "--ignore-scripts", "dev", "--", "--help"]
    });
  });

  it("injects --silent for npm run targets so screenshots omit npm script banners", () => {
    const target = resolveScreenshotTarget(["npm", "run", "demo", "--", "markdown"]);

    expect(buildSpawnSpec(target, {}, "/tmp/force-tty.cjs")).toMatchObject({
      command: "npm",
      args: ["run", "--silent", "demo", "--", "markdown"]
    });
  });

  it("does not duplicate --silent when npm run already includes it", () => {
    const target = resolveScreenshotTarget(["npm", "run", "--silent", "demo"]);

    expect(buildSpawnSpec(target, {}, "/tmp/force-tty.cjs").args).toEqual([
      "run",
      "--silent",
      "demo"
    ]);
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
    spawnMock
      .mockReturnValueOnce(createSpawnProcess() as never)
      .mockReturnValueOnce(
        createSpawnProcess({
          stdoutData: "\u001b[32mhelp\u001b[39m\n",
          stderrData: "warning\n"
        }) as never
      );

    await runScreenshot(["--poe-code", "--help"], {
      output: "screenshots/help.png"
    });

    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      "npm",
      ["run", "--silent", "--ignore-scripts", "dev", "--", "--help"],
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

  it("runs poe-code predev before capturing screenshot output", async () => {
    spawnMock
      .mockReturnValueOnce(createSpawnProcess() as never)
      .mockReturnValueOnce(
        createSpawnProcess({
          stdoutData: "\u001b[32mhelp\u001b[39m\n",
          stderrData: "warning\n"
        }) as never
      );

    await runScreenshot(["--poe-code", "--help"], {
      output: "screenshots/help.png"
    });

    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      "npm",
      ["run", "--silent", "predev"],
      expect.objectContaining({
        stdio: "inherit"
      })
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      "npm",
      ["run", "--silent", "--ignore-scripts", "dev", "--", "--help"],
      expect.objectContaining({
        stdio: ["ignore", "pipe", "pipe"]
      })
    );
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

    await vi.advanceTimersByTimeAsync(60000);

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
