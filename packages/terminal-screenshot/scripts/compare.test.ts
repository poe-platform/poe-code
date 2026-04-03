import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { renderTerminalScreenshot } from "../src/index.js";
import { runCompare } from "./compare.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn()
}));

vi.mock("node:fs/promises", () => ({
  chmod: vi.fn(),
  mkdtemp: vi.fn(),
  rm: vi.fn(),
  writeFile: vi.fn()
}));

vi.mock("../src/index.js", () => ({
  renderTerminalScreenshot: vi.fn()
}));

interface CapturedOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly io: {
    stdout: { write: (chunk: string | Uint8Array) => boolean };
    stderr: { write: (chunk: string | Uint8Array) => boolean };
  };
}

function createCapturedOutput(): CapturedOutput {
  let stdout = "";
  let stderr = "";

  return {
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    io: {
      stdout: {
        write: (chunk) => {
          stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
          return true;
        }
      },
      stderr: {
        write: (chunk) => {
          stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
          return true;
        }
      }
    }
  };
}

function createSpawnProcess(options: {
  closeCode?: number;
  error?: NodeJS.ErrnoException;
  stdoutData?: string;
} = {}) {
  const processEvents = new EventEmitter();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();

  setTimeout(() => {
    if (options.stdoutData) {
      stdout.emit("data", Buffer.from(options.stdoutData));
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
    on: processEvents.on.bind(processEvents),
    once: processEvents.once.bind(processEvents)
  };
}

const spawnMock = vi.mocked(spawn);
const chmodMock = vi.mocked(chmod);
const mkdtempMock = vi.mocked(mkdtemp);
const rmMock = vi.mocked(rm);
const writeFileMock = vi.mocked(writeFile);
const renderTerminalScreenshotMock = vi.mocked(renderTerminalScreenshot);

describe("terminal-screenshot compare script", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    chmodMock.mockReset();
    mkdtempMock.mockReset();
    rmMock.mockReset();
    writeFileMock.mockReset();
    renderTerminalScreenshotMock.mockReset();

    chmodMock.mockResolvedValue(undefined);
    mkdtempMock.mockResolvedValue("/tmp/ts-compare-dir");
    rmMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    renderTerminalScreenshotMock.mockResolvedValue(Buffer.from("new-png"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("captures help output, renders both PNGs, and prints both paths", async () => {
    const output = createCapturedOutput();
    spawnMock
      .mockReturnValueOnce(
        createSpawnProcess({ stdoutData: "\u001b[31mhelp\u001b[39m\n" }) as never
      )
      .mockReturnValueOnce(createSpawnProcess() as never);

    await runCompare(output.io);

    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      "poe-code",
      ["--help"],
      expect.objectContaining({
        env: expect.objectContaining({
          FORCE_COLOR: "1",
          PATH: expect.stringContaining("/tmp/ts-compare-dir")
        }),
        stdio: ["ignore", "pipe", "inherit"]
      })
    );
    expect(writeFileMock).toHaveBeenCalledWith(
      "/tmp/ts-compare-dir/poe-code",
      expect.stringContaining("dist/bin.cjs"),
      "utf8"
    );
    expect(chmodMock).toHaveBeenCalledWith("/tmp/ts-compare-dir/poe-code", 0o755);
    expect(writeFileMock).toHaveBeenCalledWith(
      "/tmp/ts-compare-dir/poe-code-help.ansi",
      "\u001b[31mhelp\u001b[39m\n",
      "utf8"
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      "freeze",
      [
        "/tmp/ts-compare-dir/poe-code-help.ansi",
        "-o",
        "/tmp/ts-compare-freeze.png",
        "--window",
        "--padding",
        "20",
        "--language",
        "ansi"
      ],
      expect.any(Object)
    );
    expect(renderTerminalScreenshotMock).toHaveBeenCalledWith("\u001b[31mhelp\u001b[39m\n", {
      padding: 20,
      window: true
    });
    expect(writeFileMock).toHaveBeenCalledWith("/tmp/ts-compare-new.png", Buffer.from("new-png"));
    expect(output.stdout).toContain("FREEZE: /tmp/ts-compare-freeze.png");
    expect(output.stdout).toContain("NEW:    /tmp/ts-compare-new.png");
    expect(output.stderr).toBe("");
    expect(rmMock).toHaveBeenCalledWith("/tmp/ts-compare-dir", {
      force: true,
      recursive: true
    });
  });

  it("prints FREEZE_UNAVAILABLE when freeze is missing and still renders the new PNG", async () => {
    const output = createCapturedOutput();
    const freezeUnavailable = Object.assign(new Error("spawn freeze ENOENT"), {
      code: "ENOENT"
    }) as NodeJS.ErrnoException;

    spawnMock
      .mockReturnValueOnce(createSpawnProcess({ stdoutData: "help\n" }) as never)
      .mockReturnValueOnce(createSpawnProcess({ error: freezeUnavailable }) as never);

    await runCompare(output.io);

    expect(output.stdout).toContain("FREEZE_UNAVAILABLE");
    expect(output.stdout).toContain("NEW:    /tmp/ts-compare-new.png");
    expect(output.stdout).not.toContain("FREEZE: /tmp/ts-compare-freeze.png");
    expect(writeFileMock).toHaveBeenCalledWith("/tmp/ts-compare-new.png", Buffer.from("new-png"));
  });
});
