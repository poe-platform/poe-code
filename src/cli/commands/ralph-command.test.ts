import { describe, it, expect, vi, afterEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { Command } from "commander";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";
import { renderTemplate } from "@poe-code/config-mutations";
import ralphPromptPartialPlan from "../../templates/ralph/PROMPT_PARTIAL_plan.md";
import ralphSkillPlan from "../../templates/ralph/SKILL_plan.md";
import ralphPromptBuild from "../../templates/ralph/PROMPT_build.md";

const clackSelect = vi.hoisted(() => vi.fn());
const clackIsCancel = vi.hoisted(() => vi.fn());
const designSelect = vi.hoisted(() => vi.fn());
const designIsCancel = vi.hoisted(() => vi.fn());
const designCancel = vi.hoisted(() => vi.fn());

vi.mock("@clack/prompts", () => ({
  select: clackSelect,
  isCancel: clackIsCancel
}));

vi.mock("@poe-code/design-system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/design-system")>();
  return {
    ...actual,
    select: designSelect,
    isCancel: designIsCancel,
    cancel: designCancel
  };
});

vi.mock("@poe-code/ralph", async () => {
  const actual = await vi.importActual<typeof import("@poe-code/ralph")>("@poe-code/ralph");
  return {
    ...actual,
    ralphBuild: vi.fn().mockResolvedValue({
      runId: "demo",
      iterationsCompleted: 0,
      storiesDone: [],
      iterations: [],
      stopReason: "max_iterations"
    }),
    ralphPlan: vi.fn().mockResolvedValue({
      outPath: ".agents/tasks/plan-demo.yaml"
    }),
    logActivity: vi.fn().mockResolvedValue(undefined)
  };
});

import { ralphBuild, ralphPlan, logActivity } from "@poe-code/ralph";
import { registerRalphCommand } from "./ralph.js";

const cwd = "/repo";
const homeDir = "/home/test";

function createMemFs(initial: Record<string, string> = {}): FileSystem {
  const vol = new Volume();
  vol.mkdirSync(cwd, { recursive: true });
  vol.mkdirSync(homeDir, { recursive: true });
  vol.fromJSON(initial, "/");
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

function createBaseProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program
    .name("poe-code")
    .option("-y, --yes")
    .option("--dry-run")
    .option("--verbose");
  return program;
}

describe("ralph build command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clackSelect.mockReset();
    clackIsCancel.mockReset();
    designSelect.mockReset();
    designIsCancel.mockReset();
    vi.mocked(ralphBuild).mockClear();
    vi.mocked(ralphPlan).mockClear();
    vi.mocked(logActivity).mockClear();
  });

  it("defaults iterations to 25", async () => {
    const fs = createMemFs({
      "/repo/.agents/tasks/plan.yaml": "version: 1\nproject: Demo\nstories: []\n"
    });
    designSelect.mockResolvedValueOnce(".agents/tasks/plan.yaml");
    designIsCancel.mockReturnValue(false);
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await program.parseAsync(["node", "cli", "ralph", "build"]);

    const build = vi.mocked(ralphBuild);
    expect(build).toHaveBeenCalledWith(
      expect.objectContaining({
        planPath: ".agents/tasks/plan.yaml",
        maxIterations: 25,
        agent: "codex",
        noCommit: false,
        staleSeconds: 60,
        cwd
      })
    );
  });

  it("uses config defaults when CLI flags are not provided", async () => {
    const fs = createMemFs({
      "/repo/custom-plan.yaml": "version: 1\nproject: Demo\nstories: []\n",
      "/repo/.agents/poe-code-ralph/config.yaml": [
        "planPath: custom-plan.yaml",
        "agent: claude-code",
        "maxIterations: 7",
        "noCommit: true",
        "staleSeconds: 120",
        "progressPath: custom-progress.md",
        "guardrailsPath: custom-guardrails.md",
        "errorsLogPath: custom-errors.log",
        "activityLogPath: custom-activity.log",
        ""
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

    await program.parseAsync(["node", "cli", "ralph", "build"]);

    const build = vi.mocked(ralphBuild);
    expect(build).toHaveBeenCalledWith(
      expect.objectContaining({
        planPath: "custom-plan.yaml",
        maxIterations: 7,
        agent: "claude-code",
        noCommit: true,
        staleSeconds: 120,
        progressPath: "custom-progress.md",
        guardrailsPath: "custom-guardrails.md",
        errorsLogPath: "custom-errors.log",
        activityLogPath: "custom-activity.log",
        cwd
      })
    );
  });

  it("prefers CLI flags over config defaults", async () => {
    const fs = createMemFs({
      "/repo/custom-plan.yaml": "version: 1\nproject: Demo\nstories: []\n",
      "/repo/.agents/poe-code-ralph/config.yaml": [
        "planPath: custom-plan.yaml",
        "agent: claude-code",
        "maxIterations: 7",
        ""
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

    await program.parseAsync(["node", "cli", "ralph", "build", "5", "--agent", "codex"]);

    const build = vi.mocked(ralphBuild);
    expect(build).toHaveBeenCalledWith(
      expect.objectContaining({
        maxIterations: 5,
        agent: "codex"
      })
    );
  });

  it("passes iterations argument through to the SDK", async () => {
    const fs = createMemFs({
      "/repo/.agents/tasks/plan.yaml": "version: 1\nproject: Demo\nstories: []\n"
    });
    designSelect.mockResolvedValueOnce(".agents/tasks/plan.yaml");
    designIsCancel.mockReturnValue(false);
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await program.parseAsync(["node", "cli", "ralph", "build", "5"]);

    const build = vi.mocked(ralphBuild);
    expect(build).toHaveBeenCalledWith(
      expect.objectContaining({
        maxIterations: 5
      })
    );
  });

  it("accepts --agent, --no-commit, and --plan options", async () => {
    const fs = createMemFs({
      "/repo/custom-plan.yaml": "version: 1\nstories: []\n"
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
      "build",
      "--plan",
      "custom-plan.yaml",
      "--agent",
      "claude-code",
      "--no-commit"
    ]);

    const build = vi.mocked(ralphBuild);
    expect(build).toHaveBeenCalledWith(
      expect.objectContaining({
        planPath: "custom-plan.yaml",
        agent: "claude-code",
        noCommit: true
      })
    );
  });

  it("accepts --max-failures and --pause-on-overbake options", async () => {
    const fs = createMemFs({
      "/repo/.agents/tasks/plan.yaml": "version: 1\nproject: Demo\nstories: []\n"
    });
    designSelect.mockResolvedValueOnce(".agents/tasks/plan.yaml");
    designIsCancel.mockReturnValue(false);
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
      "build",
      "--max-failures",
      "5",
      "--pause-on-overbake"
    ]);

    expect(vi.mocked(ralphBuild)).toHaveBeenCalledWith(
      expect.objectContaining({
        maxFailures: 5,
        pauseOnOverbake: true
      })
    );
  });

  it("prompts for plan selection when multiple plans exist", async () => {
    const fs = createMemFs({
      "/repo/.agents/tasks/plan-one.yaml": "version: 1\nproject: One\nstories: []\n",
      "/repo/.agents/tasks/plan-two.yaml": "version: 1\nproject: Two\nstories: []\n"
    });
    designSelect.mockResolvedValueOnce(".agents/tasks/plan-two.yaml");
    designIsCancel.mockReturnValue(false);
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await program.parseAsync(["node", "cli", "ralph", "build"]);

    expect(designSelect).toHaveBeenCalled();

    const build = vi.mocked(ralphBuild);
    expect(build).toHaveBeenCalledWith(
      expect.objectContaining({
        planPath: ".agents/tasks/plan-two.yaml"
      })
    );
  });

  it("uses global config when no local config exists", async () => {
    const fs = createMemFs({
      "/home/test/.poe-code/ralph/config.yaml": [
        "agent: claude-code",
        "maxIterations: 12",
        ""
      ].join("\n"),
      "/repo/.agents/tasks/plan.yaml": "version: 1\nproject: Demo\nstories: []\n"
    });
    designSelect.mockResolvedValueOnce(".agents/tasks/plan.yaml");
    designIsCancel.mockReturnValue(false);
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await program.parseAsync(["node", "cli", "ralph", "build"]);

    const build = vi.mocked(ralphBuild);
    expect(build).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code",
        maxIterations: 12
      })
    );
  });

  it("local config overrides global config in ralph build", async () => {
    const fs = createMemFs({
      "/home/test/.poe-code/ralph/config.yaml": [
        "agent: codex",
        "maxIterations: 12",
        ""
      ].join("\n"),
      "/repo/.agents/poe-code-ralph/config.yaml": [
        "agent: claude-code",
        ""
      ].join("\n"),
      "/repo/.agents/tasks/plan.yaml": "version: 1\nproject: Demo\nstories: []\n"
    });
    designSelect.mockResolvedValueOnce(".agents/tasks/plan.yaml");
    designIsCancel.mockReturnValue(false);
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await program.parseAsync(["node", "cli", "ralph", "build"]);

    const build = vi.mocked(ralphBuild);
    expect(build).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code",
        maxIterations: 12
      })
    );
  });

  it("merges non-overlapping fields from global and local config", async () => {
    const fs = createMemFs({
      "/home/test/.poe-code/ralph/config.yaml": [
        "agent: claude-code",
        "staleSeconds: 120",
        ""
      ].join("\n"),
      "/repo/.agents/poe-code-ralph/config.yaml": [
        "maxIterations: 5",
        "noCommit: true",
        ""
      ].join("\n"),
      "/repo/.agents/tasks/plan.yaml": "version: 1\nproject: Demo\nstories: []\n"
    });
    designSelect.mockResolvedValueOnce(".agents/tasks/plan.yaml");
    designIsCancel.mockReturnValue(false);
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await program.parseAsync(["node", "cli", "ralph", "build"]);

    const build = vi.mocked(ralphBuild);
    expect(build).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code",
        staleSeconds: 120,
        maxIterations: 5,
        noCommit: true
      })
    );
  });

  it("returns early with a helpful message when no plan is found", async () => {
    const fs = createMemFs();
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await program.parseAsync(["node", "cli", "ralph", "build"]);

    expect(vi.mocked(ralphBuild)).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });
});

describe("ralph plan command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clackSelect.mockReset();
    clackIsCancel.mockReset();
    vi.mocked(ralphBuild).mockClear();
    vi.mocked(ralphPlan).mockClear();
    vi.mocked(logActivity).mockClear();
  });

  it("throws not yet available error", async () => {
    const fs = createMemFs();
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "ralph", "plan", "Build a todo app"])
    ).rejects.toThrow(/not yet available/i);

    expect(vi.mocked(ralphPlan)).not.toHaveBeenCalled();
  });
});

describe("ralph install command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    designSelect.mockReset();
    designIsCancel.mockReset();
  });

  it("creates Ralph template files and .poe-code-ralph directory structure", async () => {
    const fs = createMemFs();
    const logs: string[] = [];

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await program.parseAsync(["node", "cli", "ralph", "install", "--agent", "claude-code", "--local"]);

    const expectedSkill = renderTemplate(ralphSkillPlan, { PROMPT_PARTIAL_PLAN: ralphPromptPartialPlan });
    expect(
      await fs.readFile("/repo/.claude/skills/poe-code-ralph-plan/SKILL.md", "utf8")
    ).toBe(expectedSkill);
    expect(
      await fs.readFile("/repo/.agents/poe-code-ralph/PROMPT_build.md", "utf8")
    ).toBe(ralphPromptBuild);

    await expect(fs.stat("/repo/.poe-code-ralph/progress.md")).resolves.toBeDefined();
    await expect(fs.stat("/repo/.poe-code-ralph/guardrails.md")).resolves.toBeDefined();
    await expect(fs.stat("/repo/.poe-code-ralph/errors.log")).resolves.toBeDefined();
    await expect(fs.stat("/repo/.poe-code-ralph/activity.log")).resolves.toBeDefined();

    expect(logs.join("\n")).toMatch(/install/i);
  });

  it("skips existing files by default", async () => {
    const fs = createMemFs({
      "/repo/.agents/poe-code-ralph/PROMPT_build.md": "EXISTING_PROMPT"
    });
    const logs: string[] = [];

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await program.parseAsync(["node", "cli", "ralph", "install", "--agent", "claude-code", "--local"]);

    expect(
      await fs.readFile("/repo/.agents/poe-code-ralph/PROMPT_build.md", "utf8")
    ).toBe("EXISTING_PROMPT");
    expect(logs.join("\n").toLowerCase()).toContain("skip");
  });

  it("overwrites existing files when --force is provided", async () => {
    const fs = createMemFs({
      "/repo/.agents/poe-code-ralph/PROMPT_build.md": "EXISTING_PROMPT"
    });

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await program.parseAsync(["node", "cli", "ralph", "install", "--agent", "claude-code", "--local", "--force"]);

    expect(
      await fs.readFile("/repo/.agents/poe-code-ralph/PROMPT_build.md", "utf8")
    ).toBe(ralphPromptBuild);
  });

  it("prompts for agent and scope when not provided", async () => {
    const fs = createMemFs();

    designSelect.mockResolvedValueOnce("claude-code").mockResolvedValueOnce("local");
    designIsCancel.mockReturnValue(false);

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await program.parseAsync(["node", "cli", "ralph", "install"]);

    expect(designSelect).toHaveBeenCalledTimes(2);

    const expectedSkill = renderTemplate(ralphSkillPlan, { PROMPT_PARTIAL_PLAN: ralphPromptPartialPlan });
    expect(
      await fs.readFile("/repo/.claude/skills/poe-code-ralph-plan/SKILL.md", "utf8")
    ).toBe(expectedSkill);
  });
});

describe("ralph agent log command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to .poe-code-ralph/activity.log", async () => {
    const fs = createMemFs();
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
      "agent",
      "log",
      "Started working on US-001"
    ]);

    expect(vi.mocked(logActivity)).toHaveBeenCalledWith(
      "/repo/.poe-code-ralph/activity.log",
      "Started working on US-001",
      expect.any(Object)
    );
  });

  it("uses config activityLogPath by default when available", async () => {
    const fs = createMemFs({
      "/repo/.agents/poe-code-ralph/config.yaml": ["activityLogPath: custom-activity.log", ""].join("\n")
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
      "agent",
      "log",
      "Started working on US-001"
    ]);

    expect(vi.mocked(logActivity)).toHaveBeenCalledWith(
      "/repo/custom-activity.log",
      "Started working on US-001",
      expect.any(Object)
    );
  });

  it("accepts --activity-log <path>", async () => {
    const fs = createMemFs();
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
      "agent",
      "log",
      "--activity-log",
      "custom-activity.log",
      "Started working on US-001"
    ]);

    expect(vi.mocked(logActivity)).toHaveBeenCalledWith(
      "/repo/custom-activity.log",
      "Started working on US-001",
      expect.any(Object)
    );
  });

  it("uses global config activityLogPath when no local config exists", async () => {
    const fs = createMemFs({
      "/home/test/.poe-code/ralph/config.yaml": [
        "activityLogPath: global-activity.log",
        ""
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
      "agent",
      "log",
      "Started working on US-001"
    ]);

    expect(vi.mocked(logActivity)).toHaveBeenCalledWith(
      "/repo/global-activity.log",
      "Started working on US-001",
      expect.any(Object)
    );
  });

  it("fails when message is empty", async () => {
    const fs = createMemFs();
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "ralph", "agent", "log", "   "])
    ).rejects.toThrow(/message/i);
  });
});
