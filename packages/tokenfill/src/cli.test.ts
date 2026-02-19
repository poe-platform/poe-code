import { beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "./cli.js";
import { tokenfill } from "./tokenfill.js";

vi.mock("./tokenfill.js", () => ({
  tokenfill: vi.fn((count: number, options?: { encoding?: string }) => ({
    text: `generated(${options?.encoding ?? "cl100k_base"}):${count}`,
    actualTokens: count
  }))
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

  const append = (chunk: string | Uint8Array): string =>
    typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");

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
          stdout += append(chunk);
          return true;
        }
      },
      stderr: {
        write: (chunk) => {
          stderr += append(chunk);
          return true;
        }
      }
    }
  };
}

const tokenfillMock = vi.mocked(tokenfill);

describe("tokenfill CLI", () => {
  beforeEach(() => {
    tokenfillMock.mockReset();
    tokenfillMock.mockImplementation((count: number, options?: { encoding?: string }) => ({
      text: `generated(${options?.encoding ?? "cl100k_base"}):${count}`,
      actualTokens: count
    }));
  });

  it("outputs generated text to stdout and stats to stderr", async () => {
    const output = createCapturedOutput();
    const exitCode = await runCli(["18"], output.io);

    expect(exitCode).toBe(0);
    expect(output.stdout).toBe("generated(cl100k_base):18");
    expect(output.stderr).toContain("Generated 18 tokens using cl100k_base");
    expect(tokenfillMock).toHaveBeenCalledWith(18, { encoding: "cl100k_base" });
  });

  it("outputs structured JSON to stdout with --json", async () => {
    const output = createCapturedOutput();
    const exitCode = await runCli(["9", "--json"], output.io);
    const payload = JSON.parse(output.stdout) as {
      text: string;
      stats: { requestedTokens: number; actualTokens: number; encoding: string };
    };

    expect(exitCode).toBe(0);
    expect(payload.stats.requestedTokens).toBe(9);
    expect(payload.stats.actualTokens).toBe(9);
    expect(payload.stats.encoding).toBe("cl100k_base");
    expect(payload.text).toBe("generated(cl100k_base):9");
    expect(output.stderr).toBe("");
    expect(tokenfillMock).toHaveBeenCalledWith(9, { encoding: "cl100k_base" });
  });

  it("applies --tokenizer to set the encoding", async () => {
    const output = createCapturedOutput();
    const exitCode = await runCli(
      ["12", "--tokenizer", "o200k_base", "--json"],
      output.io
    );
    const payload = JSON.parse(output.stdout) as {
      text: string;
      stats: { actualTokens: number; encoding: string };
    };

    expect(exitCode).toBe(0);
    expect(payload.stats.encoding).toBe("o200k_base");
    expect(payload.stats.actualTokens).toBe(12);
    expect(payload.text).toBe("generated(o200k_base):12");
    expect(tokenfillMock).toHaveBeenCalledWith(12, { encoding: "o200k_base" });
  });

  it("returns non-zero and prints to stderr for runtime errors", async () => {
    tokenfillMock.mockImplementationOnce(() => {
      throw new Error("exceeds built-in corpus size");
    });

    const output = createCapturedOutput();
    const exitCode = await runCli(["999999999"], output.io);

    expect(exitCode).toBe(1);
    expect(output.stderr).toContain("exceeds built-in corpus size");
  });

  it("uses commander parsing for invalid options", async () => {
    const output = createCapturedOutput();
    const exitCode = await runCli(["5", "--unsupported"], output.io);

    expect(exitCode).toBeGreaterThan(0);
    expect(output.stderr).toContain("unknown option '--unsupported'");
  });
});
