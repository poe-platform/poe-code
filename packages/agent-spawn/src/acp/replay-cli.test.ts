import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  realpathMock,
  findLatestLogMock,
  listSpawnLogsMock,
  pickRandomLogMock,
  replaySpawnLogMock,
  renderTableMock,
  getThemeMock
} = vi.hoisted(() => ({
  realpathMock: vi.fn<(target: string) => Promise<string>>(),
  findLatestLogMock: vi.fn<(agent?: string) => Promise<string | undefined>>(),
  listSpawnLogsMock: vi.fn<() => Promise<Array<{ filename: string; agent?: string; timestamp?: Date; path: string }>>>(),
  pickRandomLogMock: vi.fn<(agent?: string) => Promise<string | undefined>>(),
  replaySpawnLogMock: vi.fn<(filePath: string) => Promise<void>>(),
  renderTableMock: vi.fn<(options: unknown) => string>(),
  getThemeMock: vi.fn<() => { muted: (value: string) => string; header: (value: string) => string }>()
}));

const originalArgv = [...process.argv];
const originalExitCode = process.exitCode;
const cliPath = fileURLToPath(new URL("./replay-cli.ts", import.meta.url));

vi.mock("node:fs/promises", () => ({
  realpath: realpathMock
}));

vi.mock("@poe-code/design-system", () => ({
  getTheme: getThemeMock,
  renderTable: renderTableMock
}));

vi.mock("./replay.js", () => ({
  findLatestLog: findLatestLogMock,
  listSpawnLogs: listSpawnLogsMock,
  pickRandomLog: pickRandomLogMock,
  replaySpawnLog: replaySpawnLogMock
}));

async function runMain(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number | undefined }> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  process.exitCode = undefined;
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    stdoutChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8"));
    const callback = typeof rest.at(-1) === "function" ? (rest.at(-1) as (() => void)) : undefined;
    callback?.();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
    stderrChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8"));
    const callback = typeof rest.at(-1) === "function" ? (rest.at(-1) as (() => void)) : undefined;
    callback?.();
    return true;
  }) as typeof process.stderr.write;

  try {
    const { main } = await import("./replay-cli.js");
    await main(["node", "replay-cli", ...args]);
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }

  return {
    stdout: stdoutChunks.join(""),
    stderr: stderrChunks.join(""),
    exitCode: process.exitCode
  };
}

describe("acp/replay-cli", () => {
  beforeEach(() => {
    process.argv = [...originalArgv];
    process.exitCode = originalExitCode;
    realpathMock.mockReset();
    realpathMock.mockImplementation(async (target) => target);
    findLatestLogMock.mockReset();
    findLatestLogMock.mockResolvedValue("/tmp/latest.jsonl");
    listSpawnLogsMock.mockReset();
    listSpawnLogsMock.mockResolvedValue([]);
    pickRandomLogMock.mockReset();
    pickRandomLogMock.mockResolvedValue("/tmp/random.jsonl");
    replaySpawnLogMock.mockReset();
    replaySpawnLogMock.mockResolvedValue(undefined);
    renderTableMock.mockReset();
    renderTableMock.mockReturnValue("<table>\n");
    getThemeMock.mockReset();
    getThemeMock.mockReturnValue({
      muted: (value) => value,
      header: (value) => value
    });
    vi.resetModules();
  });

  it("does not execute as a side effect of importing the module", async () => {
    await import("./replay-cli.js");

    expect(findLatestLogMock).not.toHaveBeenCalled();
    expect(listSpawnLogsMock).not.toHaveBeenCalled();
    expect(pickRandomLogMock).not.toHaveBeenCalled();
    expect(replaySpawnLogMock).not.toHaveBeenCalled();
  });

  it("replays the latest log when no args are provided", async () => {
    const result = await runMain([]);

    expect(findLatestLogMock).toHaveBeenCalledWith(undefined);
    expect(replaySpawnLogMock).toHaveBeenCalledWith("/tmp/latest.jsonl");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBeUndefined();
  });

  it("replays the latest log for a specific agent", async () => {
    await runMain(["--latest", "codex"]);

    expect(findLatestLogMock).toHaveBeenCalledWith("codex");
    expect(replaySpawnLogMock).toHaveBeenCalledWith("/tmp/latest.jsonl");
  });

  it("prints the resolved random path to stderr before replaying it", async () => {
    const result = await runMain(["--random", "claude-code"]);

    expect(pickRandomLogMock).toHaveBeenCalledWith("claude-code");
    expect(replaySpawnLogMock).toHaveBeenCalledWith("/tmp/random.jsonl");
    expect(result.stderr).toContain("/tmp/random.jsonl");
  });

  it("prints a table of available logs for --list", async () => {
    listSpawnLogsMock.mockResolvedValue([
      {
        filename: "20260321-010203-004-claude-code.jsonl",
        agent: "claude-code",
        timestamp: new Date("2026-03-21T01:02:03.004Z"),
        path: "/tmp/20260321-010203-004-claude-code.jsonl"
      }
    ]);

    const result = await runMain(["--list"]);

    expect(listSpawnLogsMock).toHaveBeenCalledWith();
    expect(renderTableMock).toHaveBeenCalledWith(
      expect.objectContaining({
        rows: [
          {
            filename: "20260321-010203-004-claude-code.jsonl",
            agent: "claude-code",
            timestamp: "2026-03-21T01:02:03.004Z",
            path: "/tmp/20260321-010203-004-claude-code.jsonl"
          }
        ]
      })
    );
    expect(result.stdout).toContain("<table>");
    expect(replaySpawnLogMock).not.toHaveBeenCalled();
  });

  it("prints a helpful message when --list finds no logs", async () => {
    const result = await runMain(["--list"]);

    expect(result.stdout).toContain("No spawn logs found.");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBeUndefined();
    expect(replaySpawnLogMock).not.toHaveBeenCalled();
  });

  it("replays a positional file path directly", async () => {
    await runMain(["fixtures/session.jsonl"]);

    expect(replaySpawnLogMock).toHaveBeenCalledWith(path.resolve("fixtures/session.jsonl"));
  });

  it("prints a helpful error when no latest log exists", async () => {
    findLatestLogMock.mockResolvedValue(undefined);

    const result = await runMain([]);

    expect(result.stderr).toContain("No spawn logs found.");
    expect(result.exitCode).toBe(1);
    expect(replaySpawnLogMock).not.toHaveBeenCalled();
  });

  it("prints errors to stderr and exits with code 1 on replay failure", async () => {
    replaySpawnLogMock.mockRejectedValue(new Error("ENOENT: no such file or directory"));

    const result = await runMain(["missing.jsonl"]);

    expect(result.stderr).toContain("ENOENT: no such file or directory");
    expect(result.exitCode).toBe(1);
  });

  it("prints a helpful error when no random log exists for an agent", async () => {
    pickRandomLogMock.mockResolvedValue(undefined);

    const result = await runMain(["--random", "codex"]);

    expect(result.stderr).toContain('No spawn logs found for agent "codex".');
    expect(result.exitCode).toBe(1);
    expect(replaySpawnLogMock).not.toHaveBeenCalled();
  });

  it("rejects unknown options", async () => {
    const result = await runMain(["--wat"]);

    expect(result.stderr).toContain("Unknown option: --wat");
    expect(result.exitCode).toBe(1);
    expect(findLatestLogMock).not.toHaveBeenCalled();
    expect(replaySpawnLogMock).not.toHaveBeenCalled();
  });

  it("rejects extra arguments for --latest", async () => {
    const result = await runMain(["--latest", "codex", "extra"]);

    expect(result.stderr).toContain("--latest accepts at most one optional agent argument.");
    expect(result.exitCode).toBe(1);
    expect(findLatestLogMock).not.toHaveBeenCalled();
    expect(replaySpawnLogMock).not.toHaveBeenCalled();
  });

  it("executes when run directly through a symlinked entrypoint", async () => {
    process.argv = ["node", "/tmp/replay-bin", "--latest", "codex"];
    realpathMock.mockImplementation(async (target) => (target === "/tmp/replay-bin" ? cliPath : target));

    await import("./replay-cli.js");

    expect(findLatestLogMock).toHaveBeenCalledWith("codex");
    expect(replaySpawnLogMock).toHaveBeenCalledWith("/tmp/latest.jsonl");
  });
});
