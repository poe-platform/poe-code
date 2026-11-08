import { beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "./cli.js";
import { renderTerminalPng } from "./index.js";
import { readFile } from "node:fs/promises";

vi.mock("./index.js", () => ({
  renderTerminalPng: vi.fn()
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn()
}));

interface CapturedOutput {
  readonly stderr: string;
  readonly io: {
    stderr: { write: (chunk: string | Uint8Array) => boolean };
  };
}

function createCapturedOutput(): CapturedOutput {
  let stderr = "";

  return {
    get stderr() {
      return stderr;
    },
    io: {
      stderr: {
        write: (chunk) => {
          stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
          return true;
        }
      }
    }
  };
}

const renderTerminalPngMock = vi.mocked(renderTerminalPng);
const readFileMock = vi.mocked(readFile);

describe("terminal-png CLI", () => {
  beforeEach(() => {
    renderTerminalPngMock.mockReset();
    readFileMock.mockReset();
    readFileMock.mockResolvedValue("ansi output");
    renderTerminalPngMock.mockResolvedValue(Buffer.from("png"));
  });

  it("reads the input file and renders the screenshot with parsed options", async () => {
    const output = createCapturedOutput();
    const exitCode = await main(
      ["example.ansi", "-o", "example.png", "--no-window", "--padding", "16"],
      output.io
    );

    expect(exitCode).toBe(0);
    expect(readFileMock).toHaveBeenCalledWith("example.ansi", "utf8");
    expect(renderTerminalPngMock).toHaveBeenCalledWith("ansi output", {
      output: "example.png",
      padding: 16,
      window: false
    });
    expect(output.stderr).toBe("");
  });

  it("defaults to rendering with window chrome when --no-window is not provided", async () => {
    const output = createCapturedOutput();
    const exitCode = await main(["example.ansi", "-o", "example.png"], output.io);

    expect(exitCode).toBe(0);
    expect(renderTerminalPngMock).toHaveBeenCalledWith("ansi output", {
      output: "example.png",
      padding: undefined,
      window: true
    });
  });

  it("returns exit code 1 and prints a clear error on failure", async () => {
    const output = createCapturedOutput();
    readFileMock.mockRejectedValueOnce(new Error("missing input"));

    const exitCode = await main(["missing.ansi", "-o", "example.png"], output.io);

    expect(exitCode).toBe(1);
    expect(output.stderr).toContain("Error: missing input");
  });

  it("returns exit code 1 and prints a clear error when rendering fails", async () => {
    const output = createCapturedOutput();
    renderTerminalPngMock.mockRejectedValueOnce(new Error("render failed"));

    const exitCode = await main(["example.ansi", "-o", "example.png"], output.io);

    expect(exitCode).toBe(1);
    expect(output.stderr).toContain("Error: render failed");
  });

  it("uses commander errors for invalid padding", async () => {
    const output = createCapturedOutput();
    const exitCode = await main(
      ["example.ansi", "-o", "example.png", "--padding", "-1"],
      output.io
    );

    expect(exitCode).toBeGreaterThan(0);
    expect(output.stderr).toContain("padding must be a non-negative decimal integer");
  });

  it("rejects non-decimal padding syntax before reading input", async () => {
    for (const value of ["0x10", "1e2", "010"]) {
      const output = createCapturedOutput();
      const exitCode = await main(
        ["example.ansi", "-o", "example.png", "--padding", value],
        output.io
      );

      expect(exitCode).toBeGreaterThan(0);
      expect(output.stderr).toContain("padding must be a non-negative decimal integer");
    }

    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("rejects an empty output path before reading input", async () => {
    const output = createCapturedOutput();
    const exitCode = await main(["example.ansi", "-o", ""], output.io);

    expect(exitCode).toBeGreaterThan(0);
    expect(output.stderr).toContain("output path must not be empty");
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("uses commander errors for invalid options", async () => {
    const output = createCapturedOutput();
    const exitCode = await main(["example.ansi", "-o", "example.png", "--unsupported"], output.io);

    expect(exitCode).toBeGreaterThan(0);
    expect(output.stderr).toContain("unknown option '--unsupported'");
  });
});
