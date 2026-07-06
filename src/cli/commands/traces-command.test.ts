import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "../../utils/file-system.js";
import { createCliContainer } from "../container.js";

const { introMock, runTraceViewerMock } = vi.hoisted(() => ({
  introMock: vi.fn(),
  runTraceViewerMock: vi.fn()
}));

vi.mock("toolcraft-design", async (importOriginal) => {
  const actual = await importOriginal<typeof import("toolcraft-design")>();
  return {
    ...actual,
    intro: introMock
  };
});

vi.mock("@poe-code/agent-trace-viewer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/agent-trace-viewer")>();
  return {
    ...actual,
    runTraceViewer: runTraceViewerMock
  };
});

const { registerTracesCommand } = await import("./traces.js");

const cwd = "/repo";
const homeDir = "/home/test";

function createMemFs(): FileSystem {
  const volume = new Volume();
  volume.mkdirSync(cwd, { recursive: true });
  volume.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

function createProgram(): Command {
  return new Command()
    .exitOverride()
    .name("poe-code")
    .option("-y, --yes")
    .option("--dry-run")
    .option("--verbose");
}

function createTracesProgram(): { program: Command; fs: FileSystem } {
  const fs = createMemFs();
  const container = createCliContainer({
    fs,
    prompts: vi.fn().mockResolvedValue({}),
    env: { cwd, homeDir },
    logger: () => {}
  });
  const program = createProgram();
  registerTracesCommand(program, container);
  return { program, fs };
}

describe("traces command", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));
    introMock.mockClear();
    runTraceViewerMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delegates parsed flags to the trace viewer", async () => {
    const { program, fs } = createTracesProgram();

    await program.parseAsync([
      "node",
      "cli",
      "traces",
      "/home/test/.claude/projects/session.jsonl",
      "--source",
      "claude",
      "poe-code",
      "--all-workspaces",
      "--since",
      "2h",
      "--limit",
      "7",
      "--yes"
    ]);

    expect(introMock).toHaveBeenCalledWith("traces");
    expect(runTraceViewerMock).toHaveBeenCalledWith({
      cwd,
      homeDir,
      fs,
      assumeYes: true,
      path: "/home/test/.claude/projects/session.jsonl",
      sources: ["claude", "poe-code"],
      allWorkspaces: true,
      since: new Date("2026-07-01T10:00:00.000Z"),
      limit: 7,
      json: false
    });
  });

  it("emits json without an intro", async () => {
    const { program } = createTracesProgram();

    await program.parseAsync(["node", "cli", "traces", "--json"]);

    expect(introMock).not.toHaveBeenCalled();
    expect(runTraceViewerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assumeYes: false,
        allWorkspaces: true,
        sources: undefined,
        limit: undefined,
        json: true
      })
    );
  });

  it("reads every source and workspace by default without adding a limit", async () => {
    const { program } = createTracesProgram();

    await program.parseAsync(["node", "cli", "traces", "--yes"]);

    expect(runTraceViewerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allWorkspaces: true,
        sources: undefined,
        limit: undefined
      })
    );
  });

  it("rejects unknown trace sources with a clear error", async () => {
    const { program } = createTracesProgram();

    await expect(
      program.parseAsync(["node", "cli", "traces", "--source", "claude", "gemini"])
    ).rejects.toThrow('Unsupported trace source "gemini". Expected one of: claude, codex, poe-code.');

    expect(runTraceViewerMock).not.toHaveBeenCalled();
  });
});
