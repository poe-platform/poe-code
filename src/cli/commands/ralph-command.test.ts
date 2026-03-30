import { afterEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { Command } from "commander";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";
import { registerRalphCommand } from "./ralph.js";
import { ValidationError } from "../errors.js";
import { parseFrontmatter } from "../../../packages/ralph/src/frontmatter/frontmatter.js";

const selectMock = vi.hoisted(() => vi.fn());
const promptTextMock = vi.hoisted(() => vi.fn());
const isCancelMock = vi.hoisted(() => vi.fn().mockReturnValue(false));
const cancelMock = vi.hoisted(() => vi.fn());

vi.mock("../../sdk/ralph.js", () => ({
  runRalph: vi.fn().mockResolvedValue({
    stopReason: "max_iterations",
    docPath: ".poe-code/ralph/plans/plan-a.md",
    iterationsCompleted: 3,
    totalDurationMs: 1000
  })
}));

vi.mock("@poe-code/design-system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/design-system")>();
  return {
    ...actual,
    select: selectMock,
    promptText: promptTextMock,
    isCancel: isCancelMock,
    cancel: cancelMock
  };
});

import { runRalph as sdkRunRalph } from "../../sdk/ralph.js";

const cwd = "/repo";
const homeDir = "/home/test";

function createMemFs(files: Record<string, string> = {}): FileSystem {
  const volume = Volume.fromJSON(files, "/");
  volume.mkdirSync(cwd, { recursive: true });
  volume.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

function createBaseProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.name("poe-code").option("-y, --yes").option("--dry-run").option("--verbose");
  return program;
}

describe("ralph run command", () => {
  afterEach(() => {
    vi.clearAllMocks();
    isCancelMock.mockReturnValue(false);
  });

  it("calls the Ralph SDK with explicit CLI options", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/loop.md": "# Loop"
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "ralph",
      "run",
      "docs/loop.md",
      "--agent",
      "claude",
      "--iterations",
      "5",
      "--model",
      "gpt-5.2"
    ]);

    expect(vi.mocked(sdkRunRalph)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code",
        cwd,
        homeDir,
        docPath: "docs/loop.md",
        maxIterations: 5,
        model: "gpt-5.2"
      })
    );
  });

  it("reads agent and iterations from frontmatter and skips prompts", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/loop.md": [
          "---",
          "agent:",
          "  - claude-code",
          "  - codex",
          "iterations: 4",
          "status:",
          "  state: open",
          "  iteration: 0",
          "---",
          "# A"
        ].join("\n")
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await program.parseAsync(["node", "cli", "ralph", "run", "docs/loop.md"]);

    expect(selectMock).not.toHaveBeenCalled();
    expect(promptTextMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunRalph)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: ["claude-code", "codex"],
        docPath: "docs/loop.md",
        maxIterations: 4
      })
    );
  });

  it("prompts for missing agent, doc, and iterations when frontmatter does not provide them", async () => {
    selectMock
      .mockResolvedValueOnce(".poe-code/ralph/plans/plan-a.md")
      .mockResolvedValueOnce("codex");
    promptTextMock.mockResolvedValue("4");

    const container = createCliContainer({
      fs: createMemFs({
        "/repo/.poe-code/ralph/plans/plan-b.md": "# B",
        "/repo/.poe-code/ralph/plans/plan-a.md": "# A"
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await program.parseAsync(["node", "cli", "ralph", "run"]);

    expect(selectMock).toHaveBeenCalledTimes(2);
    expect(selectMock).toHaveBeenNthCalledWith(1, {
      message: "Select the Ralph markdown doc to run:",
      options: [
        {
          label: ".poe-code/ralph/plans/plan-a.md",
          value: ".poe-code/ralph/plans/plan-a.md"
        },
        {
          label: ".poe-code/ralph/plans/plan-b.md",
          value: ".poe-code/ralph/plans/plan-b.md"
        }
      ]
    });
    expect(selectMock).toHaveBeenNthCalledWith(2, {
      message: "Select agent to run Ralph with:",
      options: [
        { label: "claude-code", value: "claude-code" },
        { label: "codex", value: "codex" },
        { label: "opencode", value: "opencode" },
        { label: "kimi", value: "kimi" }
      ]
    });
    expect(promptTextMock).toHaveBeenCalledWith({
      message: "How many Ralph iterations should run?"
    });
    expect(vi.mocked(sdkRunRalph)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "codex",
        docPath: ".poe-code/ralph/plans/plan-a.md",
        maxIterations: 4
      })
    );
  });

  it("lets CLI flags override frontmatter values", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/loop.md": [
          "---",
          "agent: codex",
          "iterations: 4",
          "status:",
          "  state: open",
          "  iteration: 0",
          "---",
          "# A"
        ].join("\n")
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "ralph",
      "run",
      "docs/loop.md",
      "--agent",
      "claude",
      "--iterations",
      "6"
    ]);

    expect(vi.mocked(sdkRunRalph)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code",
        maxIterations: 6
      })
    );
  });

  it("fails before prompting for agent when no Ralph docs exist", async () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "ralph", "run"])
    ).rejects.toBeInstanceOf(ValidationError);

    expect(selectMock).not.toHaveBeenCalled();
    expect(promptTextMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunRalph)).not.toHaveBeenCalled();
  });

  it("uses defaults with --yes when frontmatter does not provide values", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/.poe-code/ralph/plans/plan-b.md": "# B",
        "/repo/.poe-code/ralph/plans/plan-a.md": "# A"
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "ralph", "run"]);

    expect(selectMock).not.toHaveBeenCalled();
    expect(promptTextMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunRalph)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code",
        docPath: ".poe-code/ralph/plans/plan-a.md",
        maxIterations: 3
      })
    );
  });

  it("fails fast on unknown agent names in frontmatter", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/loop.md": [
          "---",
          "agent: mystery-agent",
          "iterations: 4",
          "status:",
          "  state: open",
          "  iteration: 0",
          "---",
          "# A"
        ].join("\n")
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "ralph", "run", "docs/loop.md"])
    ).rejects.toBeInstanceOf(ValidationError);

    expect(vi.mocked(sdkRunRalph)).not.toHaveBeenCalled();
  });
});

describe("ralph init command", () => {
  afterEach(() => {
    vi.clearAllMocks();
    isCancelMock.mockReturnValue(false);
  });

  it("updates an existing doc preserving body and runtime status", async () => {
    const fs = createMemFs({
      "/repo/docs/loop.md": [
        "---",
        "status:",
        "  state: in_progress",
        "  iteration: 2",
        "---",
        "# My Plan",
        "",
        "Body"
      ].join("\n")
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "ralph",
      "init",
      "docs/loop.md",
      "--agent",
      "codex",
      "--iterations",
      "5"
    ]);

    const updated = await fs.readFile("/repo/docs/loop.md", "utf8");
    const parsed = parseFrontmatter(updated);
    expect(parsed.data).toEqual({
      agent: "codex",
      iterations: 5,
      status: {
        state: "in_progress",
        iteration: 2
      }
    });
    expect(parsed.body).toBe("# My Plan\n\nBody");
  });

  it("errors when the doc does not exist", async () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "ralph", "init", "docs/missing.md"])
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("uses CLI prompts when agent and iterations are omitted", async () => {
    const fs = createMemFs({
      "/repo/.poe-code/ralph/plans/plan-a.md": "# A"
    });
    selectMock
      .mockResolvedValueOnce(".poe-code/ralph/plans/plan-a.md")
      .mockResolvedValueOnce("codex");
    promptTextMock.mockResolvedValue("4");

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await program.parseAsync(["node", "cli", "ralph", "init"]);

    const updated = await fs.readFile(
      "/repo/.poe-code/ralph/plans/plan-a.md",
      "utf8"
    );
    const parsed = parseFrontmatter(updated);
    expect(parsed.data).toEqual({
      agent: "codex",
      iterations: 4,
      status: {
        state: "open",
        iteration: 0
      }
    });
  });

  it("uses defaults with --yes", async () => {
    const fs = createMemFs({
      "/repo/docs/loop.md": "# A"
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "--yes",
      "ralph",
      "init",
      "docs/loop.md"
    ]);

    const updated = await fs.readFile("/repo/docs/loop.md", "utf8");
    const parsed = parseFrontmatter(updated);
    expect(parsed.data).toEqual({
      agent: "claude-code",
      iterations: 3,
      status: {
        state: "open",
        iteration: 0
      }
    });
    expect(selectMock).not.toHaveBeenCalled();
    expect(promptTextMock).not.toHaveBeenCalled();
  });
});
