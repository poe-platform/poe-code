import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol, fs as memfs } from "memfs";
import { Command } from "commander";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";

vi.mock("../../providers/index.js", () => ({
  getDefaultProviders: () => []
}));

const { registerAgentScriptCommand } = await import("./agent-script-command.js");

const cwd = "/repo";
const homeDir = "/home/test";

function createBaseProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.name("poe-code").option("-y, --yes").option("--dry-run").option("--verbose");
  return program;
}

function createContainer(): ReturnType<typeof createCliContainer> {
  const fs = memfs.promises as unknown as FileSystem;
  return createCliContainer({
    fs,
    prompts: vi.fn().mockResolvedValue({}),
    env: { cwd, homeDir },
    logger: () => {}
  });
}

describe("agent-script lint command", () => {
  beforeEach(() => {
    vol.reset();
    vol.mkdirSync(cwd, { recursive: true });
    vol.mkdirSync(homeDir, { recursive: true });
    process.exitCode = undefined;
  });

  it("prints nothing and exits 0 when the file has no diagnostics", async () => {
    vol.fromJSON({
      "/repo/scripts/ok.ajs": ['import { now } from "time";', "return now();"].join("\n")
    });

    const program = createBaseProgram();
    registerAgentScriptCommand(program, createContainer());
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await program.parseAsync(["node", "cli", "agent-script", "lint", "scripts/ok.ajs"]);

    expect(writeSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
    writeSpy.mockRestore();
  });

  it("uses the default runner modules and keeps warnings at exit code 0", async () => {
    vol.fromJSON({
      "/repo/scripts/warn.ajs": 'import { now } from "time";\n'
    });

    const program = createBaseProgram();
    registerAgentScriptCommand(program, createContainer());
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await program.parseAsync(["node", "cli", "agent-script", "lint", "scripts/warn.ajs"]);

    expect(writeSpy).toHaveBeenCalledWith("/repo/scripts/warn.ajs:1:10 AS006 Import 'now' is never referenced.\n");
    expect(process.exitCode).toBe(0);
    writeSpy.mockRestore();
  });

  it("exits 1 when lint reports an error for a raw script", async () => {
    vol.fromJSON({
      "/repo/scripts/raw.ajs": ['import { meta } from "harness";', "return meta.filepath;"].join("\n")
    });

    const program = createBaseProgram();
    registerAgentScriptCommand(program, createContainer());
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await program.parseAsync(["node", "cli", "agent-script", "lint", "scripts/raw.ajs"]);

    expect(writeSpy).toHaveBeenCalledWith(
      "/repo/scripts/raw.ajs:1:22 AS004 Unknown module 'harness'. Available modules: agent, env, fail, git, log, mcp, metric, time.\n"
    );
    expect(process.exitCode).toBe(1);
    writeSpy.mockRestore();
  });

  it("reports diagnostics on original markdown file lines", async () => {
    vol.fromJSON({
      "/repo/docs/plans/example.md": [
        "---",
        "kind: pipeline",
        "version: 1",
        "---",
        "",
        "# Example",
        "",
        "```js",
        'import { missing } from "time";',
        "return missing();",
        "```"
      ].join("\n")
    });

    const program = createBaseProgram();
    registerAgentScriptCommand(program, createContainer());
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await program.parseAsync(["node", "cli", "agent-script", "lint", "docs/plans/example.md"]);

    expect(writeSpy).toHaveBeenNthCalledWith(
      1,
      "/repo/docs/plans/example.md:9:10 AS005 Module 'time' does not export 'missing'. Available exports: now, random, uuid.\n"
    );
    expect(process.exitCode).toBe(1);
    writeSpy.mockRestore();
  });

  it("keeps original markdown line numbers for BOM and CRLF content", async () => {
    vol.fromJSON({
      "/repo/docs/plans/windows.md": [
        "\uFEFF---",
        "kind: pipeline",
        "version: 1",
        "---",
        "",
        "## Windows",
        "",
        "```js",
        'import { missing } from "time";',
        "return missing();",
        "```"
      ].join("\r\n")
    });

    const program = createBaseProgram();
    registerAgentScriptCommand(program, createContainer());
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await program.parseAsync(["node", "cli", "agent-script", "lint", "docs/plans/windows.md"]);

    expect(writeSpy).toHaveBeenNthCalledWith(
      1,
      "/repo/docs/plans/windows.md:9:10 AS005 Module 'time' does not export 'missing'. Available exports: now, random, uuid.\n"
    );
    expect(process.exitCode).toBe(1);
    writeSpy.mockRestore();
  });

  it("lints markdown bodies directly when no fenced script block is present", async () => {
    vol.fromJSON({
      "/repo/docs/plans/no-fence.md": [
        "---",
        "kind: pipeline",
        "version: 1",
        "---",
        "",
        'import { uuid } from "time";',
        "return uuid();"
      ].join("\n")
    });

    const program = createBaseProgram();
    registerAgentScriptCommand(program, createContainer());
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await program.parseAsync(["node", "cli", "agent-script", "lint", "docs/plans/no-fence.md"]);

    expect(writeSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
    writeSpy.mockRestore();
  });
});

describe("agent-script run command", () => {
  beforeEach(() => {
    vol.reset();
    vol.mkdirSync(cwd, { recursive: true });
    vol.mkdirSync(homeDir, { recursive: true });
    process.exitCode = undefined;
  });

  it("runs the harness with the default module bundle and default snapshot path", async () => {
    vol.fromJSON({
      "/repo/scripts/example.ajs": "return 1;"
    });

    const runHarness = vi.fn(async (_filepath: string, options: { modulesFor: (frontmatter: Record<string, unknown>, meta: { filepath: string; kind: unknown; version: unknown }) => Record<string, unknown>; snapshotPath?: string }) => {
      const modules = options.modulesFor(
        {
          kind: "pipeline",
          version: 1
        },
        {
          filepath: "/repo/scripts/example.ajs",
          kind: "pipeline",
          version: 1
        }
      );

      expect(modules).toMatchObject({
        agent: expect.any(Object),
        env: expect.any(Object),
        fail: expect.any(Object),
        git: expect.any(Object),
        harness: expect.any(Object),
        log: expect.any(Object),
        mcp: expect.any(Object),
        metric: expect.any(Object),
        time: expect.any(Object)
      });

      return {
        ok: true,
        returnValue: {
          ok: true
        },
        snapshot: {
          sourceHash: "hash"
        },
        stats: {
          nodeVisits: 1
        }
      };
    });

    const program = createBaseProgram();
    registerAgentScriptCommand(program, createContainer(), {
      runHarness
    });
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await program.parseAsync(["node", "cli", "agent-script", "run", "scripts/example.ajs"]);

    expect(runHarness).toHaveBeenCalledWith(
      "/repo/scripts/example.ajs",
      expect.objectContaining({
        snapshotPath: "/repo/scripts/example.ajs.snapshot.json"
      })
    );
    expect(writeSpy).toHaveBeenCalledWith('{"ok":true}\n');
    expect(process.exitCode).toBe(0);
    writeSpy.mockRestore();
  });

  it("resets the overridden snapshot before running", async () => {
    vol.fromJSON({
      "/repo/scripts/example.ajs": "return 1;",
      "/repo/scripts/example.ajs.snapshot.json": '{"stale":true}',
      "/repo/state/run.json": '{"stale":true}'
    });

    const runHarness = vi.fn(async () => ({
      ok: true,
      snapshot: {
        sourceHash: "hash"
      },
      stats: {
        nodeVisits: 1
      }
    }));

    const program = createBaseProgram();
    registerAgentScriptCommand(program, createContainer(), {
      runHarness
    });

    await program.parseAsync([
      "node",
      "cli",
      "agent-script",
      "run",
      "scripts/example.ajs",
      "--snapshot",
      "state/run.json",
      "--reset"
    ]);

    expect(runHarness).toHaveBeenCalledWith(
      "/repo/scripts/example.ajs",
      expect.objectContaining({
        snapshotPath: "/repo/state/run.json"
      })
    );
    expect(vol.existsSync("/repo/state/run.json")).toBe(false);
    expect(vol.existsSync("/repo/scripts/example.ajs.snapshot.json")).toBe(true);
    expect(process.exitCode).toBe(0);
  });

  it("disables checkpointing when --no-snapshot is passed", async () => {
    vol.fromJSON({
      "/repo/scripts/example.ajs": "return 1;"
    });

    const runHarness = vi.fn(async () => ({
      ok: true,
      snapshot: {
        sourceHash: "hash"
      },
      stats: {
        nodeVisits: 1
      }
    }));

    const program = createBaseProgram();
    registerAgentScriptCommand(program, createContainer(), {
      runHarness
    });

    await program.parseAsync(["node", "cli", "agent-script", "run", "scripts/example.ajs", "--no-snapshot"]);

    expect(runHarness).toHaveBeenCalledWith(
      "/repo/scripts/example.ajs",
      expect.objectContaining({
        snapshotPath: undefined
      })
    );
    expect(process.exitCode).toBe(0);
  });

  it("prints runtime errors and exits 1 when the harness reports a failed result", async () => {
    vol.fromJSON({
      "/repo/scripts/example.ajs": "return 1;"
    });

    const runHarness = vi.fn(async () => ({
      ok: false,
      error: {
        code: "UNBOUND_IDENTIFIER",
        message: "Identifier 'missing' is not defined.",
        nodeType: "Identifier",
        span: {
          start: {
            line: 3,
            column: 5,
            offset: 10
          },
          end: {
            line: 3,
            column: 12,
            offset: 17
          }
        }
      },
      snapshot: {
        sourceHash: "hash"
      },
      stats: {
        nodeVisits: 1
      }
    }));

    const program = createBaseProgram();
    registerAgentScriptCommand(program, createContainer(), {
      runHarness
    });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await program.parseAsync(["node", "cli", "agent-script", "run", "scripts/example.ajs"]);

    expect(stderrSpy).toHaveBeenCalledWith(
      "/repo/scripts/example.ajs:3:5 Identifier 'missing' is not defined.\n"
    );
    expect(process.exitCode).toBe(1);
    stderrSpy.mockRestore();
  });

  it("prints lint diagnostics and exits 1 when runHarness rejects with diagnostics", async () => {
    vol.fromJSON({
      "/repo/scripts/example.ajs": "return 1;"
    });

    const runHarness = vi.fn(async () => {
      throw {
        diagnostics: [
          {
            filename: "/repo/scripts/example.ajs",
            line: 1,
            column: 8,
            code: "AS999",
            message: "Boom.",
            severity: "error"
          }
        ]
      };
    });

    const program = createBaseProgram();
    registerAgentScriptCommand(program, createContainer(), {
      runHarness
    });
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await program.parseAsync(["node", "cli", "agent-script", "run", "scripts/example.ajs"]);

    expect(stdoutSpy).toHaveBeenCalledWith("/repo/scripts/example.ajs:1:8 AS999 Boom.\n");
    expect(process.exitCode).toBe(1);
    stdoutSpy.mockRestore();
  });

  it("ignores missing snapshots when --reset is passed", async () => {
    vol.fromJSON({
      "/repo/scripts/example.ajs": "return 1;"
    });

    const runHarness = vi.fn(async () => ({
      ok: true,
      snapshot: {
        sourceHash: "hash"
      },
      stats: {
        nodeVisits: 1
      }
    }));

    const program = createBaseProgram();
    registerAgentScriptCommand(program, createContainer(), {
      runHarness
    });

    await program.parseAsync(["node", "cli", "agent-script", "run", "scripts/example.ajs", "--reset"]);

    expect(runHarness).toHaveBeenCalledWith(
      "/repo/scripts/example.ajs",
      expect.objectContaining({
        snapshotPath: "/repo/scripts/example.ajs.snapshot.json"
      })
    );
    expect(process.exitCode).toBe(0);
  });
});
