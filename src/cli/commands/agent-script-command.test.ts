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
