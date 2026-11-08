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

vi.mock("@poe-code/agent-trace-viewer", () => ({
  runTraceViewer: runTraceViewerMock
}));

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

function createTracesProgram() {
  const fs = createMemFs();
  const logger = vi.fn();
  const container = createCliContainer({
    fs,
    prompts: vi.fn(async () => {
      throw new Error("Unexpected prompt");
    }),
    commandRunner: vi.fn(async () => {
      throw new Error("Unexpected command execution");
    }),
    httpClient: vi.fn(async () => {
      throw new Error("Unexpected HTTP request");
    }),
    env: { cwd, homeDir },
    logger
  });
  const program = createProgram();
  registerTracesCommand(program, container);
  return { program, fs, logger };
}

describe("traces command", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));
    introMock.mockClear();
    runTraceViewerMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe.each([
    { name: "leading global flag", prefix: ["--dry-run", "traces"], suffix: [] },
    { name: "trailing global flag", prefix: ["traces"], suffix: ["--dry-run"] },
    { name: "trace alias", prefix: ["trace"], suffix: ["--dry-run"] }
  ])("dry run with $name", ({ prefix, suffix }) => {
    it.each([
      { mode: "listing", args: [], messages: ["Dry run: would list traces."] },
      {
        mode: "path",
        args: ["/tmp/session.jsonl"],
        messages: ["Dry run: would display trace /tmp/session.jsonl."]
      },
      {
        mode: "HTML output",
        args: ["/tmp/session.jsonl", "--html-out", "/tmp/out.html"],
        messages: ["Dry run: would export trace /tmp/session.jsonl as HTML to /tmp/out.html."]
      },
      {
        mode: "browser",
        args: ["/tmp/session.jsonl", "--open"],
        messages: [
          "Dry run: would export trace /tmp/session.jsonl as HTML.",
          "Dry run: would open the HTML in a browser."
        ]
      },
      {
        mode: "HTML and browser",
        args: ["/tmp/session.jsonl", "--open", "--html-out", "/tmp/out.html"],
        messages: [
          "Dry run: would export trace /tmp/session.jsonl as HTML to /tmp/out.html.",
          "Dry run: would open the HTML in a browser."
        ]
      },
      {
        mode: "index rebuild",
        args: ["--rebuild-index"],
        messages: ["Dry run: would rebuild the trace index.", "Dry run: would list traces."]
      },
      {
        mode: "index rebuild and path",
        args: ["/tmp/session.jsonl", "--rebuild-index"],
        messages: ["Dry run: would display trace /tmp/session.jsonl."]
      }
    ])("previews $mode without invoking the viewer", async ({ args, messages }) => {
      const { program, fs, logger } = createTracesProgram();

      await program.parseAsync(["node", "cli", ...prefix, ...args, ...suffix]);

      expect(runTraceViewerMock).not.toHaveBeenCalled();
      expect(logger.mock.calls.map(([message]) => message)).toEqual(messages);
      expect(logger.mock.calls.flat().join("\n")).not.toContain("{");
      expect(logger.mock.calls.flat().join("\n")).not.toContain(cwd);
      expect(logger.mock.calls.flat().join("\n")).not.toContain(homeDir);
      expect(await fs.readdir(cwd)).toEqual([]);
      expect(await fs.readdir(homeDir)).toEqual([]);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("shows only requested filters with parsed values", async () => {
      const { program, logger } = createTracesProgram();

      await program.parseAsync([
        "node",
        "cli",
        ...prefix,
        "--source",
        "claude",
        "codex",
        "--since",
        "2h",
        "--limit",
        "007",
        "--full-titles",
        ...suffix
      ]);

      expect(runTraceViewerMock).not.toHaveBeenCalled();
      expect(logger.mock.calls.map(([message]) => message)).toEqual([
        "Dry run: would list traces.",
        "Sources: claude, codex",
        "Since: 2026-07-01T10:00:00.000Z",
        "Limit: 7",
        "Titles: full"
      ]);
    });

    it.each([undefined, "/tmp/session.jsonl"])(
      "emits only a JSON preview for path %s with parsed options",
      async (pathArg) => {
        const { program, logger } = createTracesProgram();
        const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);

        await program.parseAsync([
          "node",
          "cli",
          ...prefix,
          ...(pathArg === undefined ? [] : [pathArg]),
          "--json",
          "--source",
          "claude",
          "codex",
          "--since",
          "2h",
          "--limit",
          "7",
          "--yes",
          "--all-workspaces",
          "--full-titles",
          "--rebuild-index",
          ...suffix
        ]);

        expect(runTraceViewerMock).not.toHaveBeenCalled();
        expect(stdout).toHaveBeenCalledTimes(1);
        expect(JSON.parse(String(stdout.mock.calls[0][0]))).toEqual({
          dryRun: true,
          operation: "traces",
          options: {
            cwd,
            homeDir,
            assumeYes: true,
            ...(pathArg === undefined ? {} : { path: pathArg }),
            sources: ["claude", "codex"],
            allWorkspaces: true,
            since: "2026-07-01T10:00:00.000Z",
            limit: 7,
            json: true,
            fullTitles: true,
            open: false,
            rebuildIndex: true
          }
        });
        expect(introMock).not.toHaveBeenCalled();
        expect(logger).not.toHaveBeenCalled();
      }
    );
  });

  describe.each([false, true])("validation with dryRun=%s", (dryRun) => {
    it.each([
      { args: ["--open"], error: "--open requires a trace path." },
      {
        args: ["--html-out", "/tmp/out.html"],
        error: "--html-out requires a trace path."
      },
      {
        args: ["/tmp/session.jsonl", "--open", "--json"],
        error: "--open cannot be used with --json."
      },
      {
        args: ["/tmp/session.jsonl", "--html-out", "/tmp/out.html", "--json"],
        error: "--html-out cannot be used with --json."
      },
      { args: ["--source", "gemini"], error: 'Unsupported trace source "gemini".' },
      { args: ["--since", "invalid"], error: 'Invalid duration for --since: "invalid".' },
      { args: ["--since", "0h"], error: 'Invalid duration for --since: "0h".' },
      { args: ["--since", "-2h"], error: 'Invalid duration for --since: "-2h".' },
      { args: ["--limit", "0"], error: 'Invalid --limit value "0".' },
      { args: ["--limit", "-1"], error: 'Invalid --limit value "-1".' },
      { args: ["--limit", "1.5"], error: 'Invalid --limit value "1.5".' },
      { args: ["--limit", "bad"], error: 'Invalid --limit value "bad".' },
      { args: ["--limit", " "], error: 'Invalid --limit value " ".' }
    ])("rejects $args before preview or delegation", async ({ args, error }) => {
      const { program, logger } = createTracesProgram();
      const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);

      await expect(
        program.parseAsync([
          "node",
          "cli",
          ...(dryRun ? ["--dry-run"] : []),
          "traces",
          ...args
        ])
      ).rejects.toThrow(error);

      expect(runTraceViewerMock).not.toHaveBeenCalled();
      expect(logger).not.toHaveBeenCalled();
      expect(stdout).not.toHaveBeenCalled();
    });
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
      "pi",
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
      sources: ["claude", "pi", "poe-code"],
      allWorkspaces: true,
      since: new Date("2026-07-01T10:00:00.000Z"),
      limit: 7,
      json: false,
      fullTitles: false,
      open: false,
      htmlOut: undefined,
      rebuildIndex: false
    });
  });

  it("supports trace as an alias", async () => {
    const { program } = createTracesProgram();

    await program.parseAsync(["node", "cli", "trace", "--json"]);

    expect(program.commands.find((command) => command.name() === "traces")?.aliases()).toContain(
      "trace"
    );
    expect(runTraceViewerMock).toHaveBeenCalledWith(expect.objectContaining({ json: true }));
  });

  it("forwards --full-titles to the trace viewer", async () => {
    const { program } = createTracesProgram();

    await program.parseAsync(["node", "cli", "traces", "--json", "--full-titles"]);

    expect(runTraceViewerMock).toHaveBeenCalledWith(
      expect.objectContaining({ json: true, fullTitles: true })
    );
  });

  it("forwards --open and --html-out for a path", async () => {
    const { program } = createTracesProgram();

    await program.parseAsync([
      "node",
      "cli",
      "traces",
      "/tmp/session.jsonl",
      "--open",
      "--html-out",
      "/tmp/out.html"
    ]);

    expect(runTraceViewerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/tmp/session.jsonl",
        open: true,
        htmlOut: "/tmp/out.html",
        json: false
      })
    );
  });

  it("requires a path for --open and --html-out", async () => {
    const { program } = createTracesProgram();

    await expect(program.parseAsync(["node", "cli", "traces", "--open"])).rejects.toThrow(
      "--open requires a trace path."
    );
    await expect(
      program.parseAsync(["node", "cli", "traces", "--html-out", "/tmp/out.html"])
    ).rejects.toThrow("--html-out requires a trace path.");
    expect(runTraceViewerMock).not.toHaveBeenCalled();
  });

  it("rejects --open/--html-out with --json", async () => {
    const { program } = createTracesProgram();

    await expect(
      program.parseAsync(["node", "cli", "traces", "/tmp/session.jsonl", "--open", "--json"])
    ).rejects.toThrow("--open cannot be used with --json.");
    await expect(
      program.parseAsync([
        "node",
        "cli",
        "traces",
        "/tmp/session.jsonl",
        "--html-out",
        "/tmp/out.html",
        "--json"
      ])
    ).rejects.toThrow("--html-out cannot be used with --json.");
    expect(runTraceViewerMock).not.toHaveBeenCalled();
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
    ).rejects.toThrow(
      'Unsupported trace source "gemini". Expected one of: claude, codex, pi, poe-code.'
    );

    expect(runTraceViewerMock).not.toHaveBeenCalled();
  });
});
