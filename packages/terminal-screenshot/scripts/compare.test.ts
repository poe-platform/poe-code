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

  it("captures help output, renders the PNG, and prints its path", async () => {
    const output = createCapturedOutput();
    spawnMock.mockReturnValueOnce(
      createSpawnProcess({ stdoutData: "\u001b[31mhelp\u001b[39m\n" }) as never
    );

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
    expect(renderTerminalScreenshotMock).toHaveBeenCalledWith("\u001b[31mhelp\u001b[39m\n", {
      output: "/tmp/ts-compare-new.png",
      padding: 20,
      window: true
    });
    expect(output.stdout).toContain("PNG: /tmp/ts-compare-new.png");
    expect(output.stderr).toBe("");
    expect(rmMock).toHaveBeenCalledWith("/tmp/ts-compare-dir", {
      force: true,
      recursive: true
    });
  });

  it("still renders the PNG when help output includes plain text", async () => {
    const output = createCapturedOutput();
    spawnMock.mockReturnValueOnce(createSpawnProcess({ stdoutData: "help\n" }) as never);

    await runCompare(output.io);

    expect(output.stdout).toContain("PNG: /tmp/ts-compare-new.png");
    expect(renderTerminalScreenshotMock).toHaveBeenCalledWith("help\n", {
      output: "/tmp/ts-compare-new.png",
      padding: 20,
      window: true
    });
  });
});
