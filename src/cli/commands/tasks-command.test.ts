import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol, fs as memfs } from "memfs";
import { Command } from "commander";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";
import type {
  MoveTasksOptions,
  SyncGhProjectReport,
  VerifyGhProjectReport
} from "@poe-code/task-list";

const taskListMocks = vi.hoisted(() => {
  class MockGhProjectSyncError extends Error {
    readonly op: "lookup" | "createProject" | "createField" | "createOption";
    readonly target: string;

    constructor(options: {
      op: "lookup" | "createProject" | "createField" | "createOption";
      target: string;
      message: string;
    }) {
      super(options.message);
      this.name = "GhProjectSyncError";
      this.op = options.op;
      this.target = options.target;
    }
  }

  return {
    GhProjectSyncError: MockGhProjectSyncError,
    moveTasks: vi.fn(),
    resolveAuth: vi.fn(),
    syncGhProject: vi.fn(),
    verifyGhProject: vi.fn()
  };
});

const designSystemMocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  isCancel: vi.fn(() => false)
}));

vi.mock("@poe-code/task-list", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/task-list")>();
  return {
    ...actual,
    GhProjectSyncError: taskListMocks.GhProjectSyncError,
    moveTasks: taskListMocks.moveTasks,
    resolveAuth: taskListMocks.resolveAuth,
    syncGhProject: taskListMocks.syncGhProject,
    verifyGhProject: taskListMocks.verifyGhProject
  };
});

vi.mock("toolcraft-design", async (importOriginal) => {
  const actual = await importOriginal<typeof import("toolcraft-design")>();
  return {
    ...actual,
    confirm: designSystemMocks.confirm,
    isCancel: designSystemMocks.isCancel
  };
});

vi.mock("../../providers/index.js", () => ({
  getDefaultProviders: () => []
}));

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { registerTasksCommand } = await import("./tasks.js");

const cwd = process.cwd();
const homeDir = "/home/test";

function createBaseProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.name("poe-code").option("-y, --yes").option("--dry-run").option("--verbose");
  return program;
}

function createContainer(logs: string[] = []): ReturnType<typeof createCliContainer> {
  return createCliContainer({
    fs: memfs.promises as unknown as FileSystem,
    prompts: vi.fn().mockResolvedValue({}),
    env: { cwd, homeDir },
    logger: (message) => logs.push(message)
  });
}

function seedWorkflow(frontmatter: string, path = `${cwd}/WORKFLOW.md`): void {
  vol.fromJSON(
    {
      [path]: ["---", frontmatter.trim(), "---", "# Workflow", ""].join("\n")
    },
    "/"
  );
}

function seedTaskWorkspace(
  options: {
    state?: string;
    description?: string;
    workflowFrontmatter?: string;
  } = {}
): void {
  const state = options.state ?? "queued";
  const description = options.description ?? "Initial description";
  vol.fromJSON(
    {
      [`${cwd}/WORKFLOW.md`]: [
        "---",
        (
          options.workflowFrontmatter ??
          `
tasks:
  type: markdown-dir
  path: ${cwd}/tasks
states:
  queued:
    prompt: Run it
  agent-running:
    prompt: Keep going
  done:
    terminal: true
`
        ).trim(),
        "---",
        "# Workflow",
        ""
      ].join("\n"),
      [`${cwd}/tasks/plans/foo.md`]: [
        "---",
        "kind: task",
        "version: 1",
        "name: Foo task",
        `state: ${state}`,
        "priority: high",
        "---",
        "",
        description
      ].join("\n")
    },
    "/"
  );
}

function createVerifyReport(overrides: Partial<VerifyGhProjectReport> = {}): VerifyGhProjectReport {
  return {
    ok: true,
    project: { id: "project-id", number: 12, owner: "acme" },
    statusField: { id: "status-id", options: ["queued", "done"] },
    missingProject: false,
    missingStatusField: false,
    missingOptions: [],
    ...overrides
  };
}

function createSyncReport(overrides: Partial<SyncGhProjectReport> = {}): SyncGhProjectReport {
  return {
    ...createVerifyReport(),
    created: [],
    updated: [],
    ...overrides
  };
}

async function runTasks(args: string[], logs: string[] = []): Promise<void> {
  const program = createBaseProgram();
  registerTasksCommand(program, createContainer(logs));
  await program.parseAsync(["node", "cli", "tasks", ...args]);
}

function setStdinTTY(value: boolean): () => void {
  const original = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value
  });

  return () => {
    if (original === undefined) {
      delete (process.stdin as { isTTY?: boolean }).isTTY;
      return;
    }

    Object.defineProperty(process.stdin, "isTTY", original);
  };
}

describe("tasks command", () => {
  beforeEach(() => {
    vol.reset();
    vol.mkdirSync(cwd, { recursive: true });
    vol.mkdirSync(homeDir, { recursive: true });
    taskListMocks.verifyGhProject.mockReset();
    taskListMocks.syncGhProject.mockReset();
    taskListMocks.moveTasks.mockReset().mockResolvedValue({ created: 0, skipped: 0, errors: [] });
    taskListMocks.resolveAuth.mockReset().mockResolvedValue("fallback-token");
    designSystemMocks.confirm.mockReset().mockResolvedValue(false);
    designSystemMocks.isCancel.mockReset().mockReturnValue(false);
    process.exitCode = undefined;
  });

  it("verify exits 0 when the report is ok", async () => {
    seedWorkflow(`
maestro:
  active_states:
    - queued
  terminal_states:
    - done
`);
    taskListMocks.verifyGhProject.mockResolvedValue(createVerifyReport());

    await runTasks(["verify", "acme/12"]);

    expect(process.exitCode).toBeUndefined();
  });

  it("verify exits non-zero when the report is not ok", async () => {
    seedWorkflow(`
maestro:
  active_states:
    - queued
  terminal_states:
    - done
`);
    taskListMocks.verifyGhProject.mockResolvedValue(
      createVerifyReport({ ok: false, missingOptions: ["done"] })
    );

    await runTasks(["verify", "acme/12"]);

    expect(process.exitCode).toBe(1);
  });

  it("verify forwards the workflow's tasks.auth.token after env expansion", async () => {
    const restoreEnv = process.env.VERIFY_TOKEN_TEST;
    process.env.VERIFY_TOKEN_TEST = "ghp_verify_token";
    seedWorkflow(`
maestro:
  active_states:
    - queued
  terminal_states:
    - done
tasks:
  auth:
    token: $VERIFY_TOKEN_TEST
`);
    taskListMocks.verifyGhProject.mockResolvedValue(createVerifyReport());

    try {
      await runTasks(["verify", "acme/12"]);
    } finally {
      if (restoreEnv === undefined) {
        delete process.env.VERIFY_TOKEN_TEST;
      } else {
        process.env.VERIFY_TOKEN_TEST = restoreEnv;
      }
    }

    expect(taskListMocks.verifyGhProject).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { token: "ghp_verify_token" } })
    );
  });

  it("verify falls back to gh auth token when none is configured", async () => {
    seedWorkflow(`
maestro:
  active_states:
    - queued
  terminal_states:
    - done
`);
    taskListMocks.verifyGhProject.mockResolvedValue(createVerifyReport());

    await runTasks(["verify", "acme/12"]);

    expect(taskListMocks.verifyGhProject).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { token: "fallback-token" } })
    );
  });

  it("sync passes merged frontmatter and flags to the SDK call", async () => {
    seedWorkflow(`
maestro:
  active_states:
    - queued
  terminal_states:
    - done
tasks:
  repo: frontmatter/repo
`);
    taskListMocks.syncGhProject.mockResolvedValue(createSyncReport());

    await runTasks(["sync", "acme/12", "--repo", "flag/repo", "--yes"]);

    expect(taskListMocks.syncGhProject).toHaveBeenCalledWith({
      owner: "acme",
      number: 12,
      requiredStates: ["queued", "done"],
      repo: "flag/repo",
      auth: { token: "fallback-token" },
      workflowPath: "./WORKFLOW.md",
      yes: true
    });
  });

  it("sync forwards --title to the SDK call for new projects", async () => {
    seedWorkflow(`
maestro:
  active_states:
    - queued
  terminal_states:
    - done
`);
    taskListMocks.syncGhProject.mockResolvedValue(createSyncReport());

    await runTasks(["sync", "acme/0", "--title", "Bugs", "--yes"]);

    expect(taskListMocks.syncGhProject).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Bugs" })
    );
  });

  it("sync forwards the workflow's tasks.auth.token after env expansion", async () => {
    const restoreEnv = process.env.SYNC_TOKEN_TEST;
    process.env.SYNC_TOKEN_TEST = "ghp_envtoken";
    seedWorkflow(`
maestro:
  active_states:
    - queued
  terminal_states:
    - done
tasks:
  auth:
    token: $SYNC_TOKEN_TEST
`);
    taskListMocks.syncGhProject.mockResolvedValue(createSyncReport());

    try {
      await runTasks(["sync", "acme/12", "--yes"]);
    } finally {
      if (restoreEnv === undefined) {
        delete process.env.SYNC_TOKEN_TEST;
      } else {
        process.env.SYNC_TOKEN_TEST = restoreEnv;
      }
    }

    expect(taskListMocks.syncGhProject).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { token: "ghp_envtoken" } })
    );
  });

  it("prints verify --json as exactly the report JSON", async () => {
    seedWorkflow(`
maestro:
  active_states:
    - queued
  terminal_states:
    - done
`);
    const report = createVerifyReport();
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    taskListMocks.verifyGhProject.mockResolvedValue(report);

    try {
      await runTasks(["verify", "acme/12", "--json"]);
      expect(stdout).toHaveBeenCalledWith(`${JSON.stringify(report)}\n`);
    } finally {
      stdout.mockRestore();
    }
  });

  it("prints sync --json as exactly the report JSON", async () => {
    seedWorkflow(`
maestro:
  active_states:
    - queued
  terminal_states:
    - done
`);
    const report = createSyncReport({ created: ["project", "field"] });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    taskListMocks.syncGhProject.mockResolvedValue(report);

    try {
      await runTasks(["sync", "acme/12", "--yes", "--json"]);
      expect(stdout).toHaveBeenCalledWith(`${JSON.stringify(report)}\n`);
    } finally {
      stdout.mockRestore();
    }
  });

  it("prints sync --json missing-resource reports without prompting in non-interactive mode", async () => {
    seedWorkflow(`
maestro:
  active_states:
    - queued
  terminal_states:
    - done
`);
    const report = createSyncReport({
      ok: false,
      missingStatusField: true,
      missingOptions: ["queued", "done"]
    });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const restoreTTY = setStdinTTY(false);
    taskListMocks.syncGhProject.mockResolvedValue(report);

    try {
      await runTasks(["sync", "acme/12", "--json"]);
      expect(stdout).toHaveBeenCalledWith(`${JSON.stringify(report)}\n`);
    } finally {
      restoreTTY();
      stdout.mockRestore();
    }

    expect(designSystemMocks.confirm).not.toHaveBeenCalled();
    expect(taskListMocks.syncGhProject).toHaveBeenCalledTimes(1);
    expect(taskListMocks.syncGhProject).toHaveBeenCalledWith(
      expect.objectContaining({ yes: false })
    );
    expect(process.exitCode).toBe(1);
  });

  it("sync refuses non-interactive runs without --yes", async () => {
    seedWorkflow(`
maestro:
  active_states:
    - queued
  terminal_states:
    - done
`);
    const logs: string[] = [];
    const restoreTTY = setStdinTTY(false);

    try {
      await runTasks(["sync", "acme/12"], logs);
    } finally {
      restoreTTY();
    }

    expect(process.exitCode).toBe(1);
    expect(taskListMocks.syncGhProject).not.toHaveBeenCalled();
    expect(logs).toEqual([
      "[error] tasks sync requires --yes when running without an interactive TTY."
    ]);
  });

  it("sync permits interactive runs without --yes when the project is already synced", async () => {
    seedWorkflow(`
maestro:
  active_states:
    - queued
  terminal_states:
    - done
`);
    taskListMocks.syncGhProject.mockResolvedValue(createSyncReport());
    const restoreTTY = setStdinTTY(true);

    try {
      await runTasks(["sync", "acme/12"]);
    } finally {
      restoreTTY();
    }

    expect(process.exitCode).toBeUndefined();
    expect(designSystemMocks.confirm).not.toHaveBeenCalled();
    expect(taskListMocks.syncGhProject).toHaveBeenCalledWith(
      expect.objectContaining({ yes: false })
    );
  });

  it("sync prompts before provisioning missing resources without --yes", async () => {
    seedWorkflow(`
maestro:
  active_states:
    - queued
  terminal_states:
    - done
`);
    const missingReport = createSyncReport({
      ok: false,
      missingStatusField: true,
      missingOptions: ["queued", "done"]
    });
    taskListMocks.syncGhProject
      .mockResolvedValueOnce(missingReport)
      .mockResolvedValueOnce(
        createSyncReport({ created: ["field", "option:queued", "option:done"] })
      );
    designSystemMocks.confirm.mockResolvedValueOnce(true);
    const restoreTTY = setStdinTTY(true);

    try {
      await runTasks(["sync", "acme/12"]);
    } finally {
      restoreTTY();
    }

    expect(designSystemMocks.confirm).toHaveBeenCalledWith({
      message: "Create missing GitHub Project resources (Status field; status options: queued, done)?"
    });
    expect(taskListMocks.syncGhProject).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ yes: false })
    );
    expect(taskListMocks.syncGhProject).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ yes: true })
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("sync leaves missing resources untouched when interactive confirmation is declined", async () => {
    seedWorkflow(`
maestro:
  active_states:
    - queued
  terminal_states:
    - done
`);
    const logs: string[] = [];
    taskListMocks.syncGhProject.mockResolvedValue(
      createSyncReport({
        ok: false,
        missingProject: true,
        missingStatusField: true,
        missingOptions: ["queued", "done"]
      })
    );
    designSystemMocks.confirm.mockResolvedValueOnce(false);
    const restoreTTY = setStdinTTY(true);

    try {
      await runTasks(["sync", "acme/12"], logs);
    } finally {
      restoreTTY();
    }

    expect(taskListMocks.syncGhProject).toHaveBeenCalledTimes(1);
    expect(taskListMocks.syncGhProject).toHaveBeenCalledWith(
      expect.objectContaining({ yes: false })
    );
    expect(process.exitCode).toBe(1);
    expect(logs).toContain("[error] GitHub Project sync did not complete.");
  });

  it("sync prints GhProjectSyncError op and target on failure", async () => {
    seedWorkflow(`
maestro:
  active_states:
    - queued
  terminal_states:
    - done
`);
    const logs: string[] = [];
    taskListMocks.syncGhProject.mockRejectedValue(
      new taskListMocks.GhProjectSyncError({
        op: "createOption",
        target: "done",
        message: "permission denied"
      })
    );

    await runTasks(["sync", "acme/12", "--yes"], logs);

    expect(process.exitCode).toBe(1);
    expect(logs).toEqual(["[error] permission denied (op=createOption, target=done)"]);
  });

  it("sync prints the new project number and manual WORKFLOW.md instruction", async () => {
    seedWorkflow(`
maestro:
  active_states:
    - queued
  terminal_states:
    - done
`);
    const logs: string[] = [];
    taskListMocks.syncGhProject.mockResolvedValue(
      createSyncReport({
        project: { id: "new-project-id", owner: "acme", number: 34 },
        created: ["project", "field"]
      })
    );

    await runTasks(["sync", "acme/12", "--yes"], logs);

    expect(logs).toContain("[info] Created GitHub Project #34.");
    expect(logs).toContain("[warn] Update WORKFLOW.md manually with project acme/34.");
  });

  it("--json skips human log lines", async () => {
    seedWorkflow(`
maestro:
  active_states:
    - queued
  terminal_states:
    - done
`);
    const report = createVerifyReport({ ok: false, missingOptions: ["done"] });
    const logs: string[] = [];
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    taskListMocks.verifyGhProject.mockResolvedValue(report);

    try {
      await runTasks(["verify", "acme/12", "--json"], logs);
      expect(logs).toEqual([]);
      expect(stdout).toHaveBeenCalledWith(`${JSON.stringify(report)}\n`);
    } finally {
      stdout.mockRestore();
    }
  });

  it("--workflow falls back to ./WORKFLOW.md", async () => {
    seedWorkflow(`
maestro:
  active_states:
    - queued
  terminal_states:
    - done
`);
    taskListMocks.verifyGhProject.mockResolvedValue(createVerifyReport());

    await runTasks(["verify", "acme/12"]);

    expect(taskListMocks.verifyGhProject).toHaveBeenCalledWith(
      expect.objectContaining({ workflowPath: "./WORKFLOW.md" })
    );
  });

  it("--states overrides frontmatter", async () => {
    seedWorkflow(`
maestro:
  active_states:
    - queued
  terminal_states:
    - done
`);
    taskListMocks.verifyGhProject.mockResolvedValue(createVerifyReport());

    await runTasks(["verify", "acme/12", "--states", "triage,blocked"]);

    expect(taskListMocks.verifyGhProject).toHaveBeenCalledWith(
      expect.objectContaining({ requiredStates: ["triage", "blocked"] })
    );
  });

  it("move parses SDK flags from task-only workflow files", async () => {
    seedWorkflow(
      `
tasks:
  type: markdown-dir
  path: ./source-tasks
`,
      `${cwd}/source.md`
    );
    seedWorkflow(
      `
tasks:
  type: yaml-file
  path: ./target.yml
states:
  draft:
    prompt: Triage it
  done:
    terminal: true
`,
      `${cwd}/target.md`
    );

    await runTasks([
      "move",
      "--from",
      `${cwd}/source.md`,
      "--to",
      `${cwd}/target.md`,
      "--delete-source",
      "--rate",
      "25",
      "--limit",
      "8",
      "--dry-run",
      "--state-map",
      "queued:Todo,done:Done,"
    ]);

    expect(taskListMocks.moveTasks).toHaveBeenCalledWith({
      source: { type: "markdown-dir", path: `${cwd}/source-tasks` },
      target: {
        type: "yaml-file",
        path: `${cwd}/target.yml`,
        stateMachine: {
          initial: "draft",
          states: ["draft", "done"],
          events: {
            draft: { from: "*", to: "draft" },
            done: { from: "*", to: "done" }
          }
        }
      },
      deleteSource: true,
      rate: 25,
      limit: 8,
      dryRun: true,
      stateMap: { queued: "Todo", done: "Done" },
      onProgress: expect.any(Function)
    });
  });

  it("move accepts prototype-named source states in --state-map", async () => {
    seedWorkflow(
      `
tasks:
  type: markdown-dir
  path: ./source-tasks
`,
      `${cwd}/source.md`
    );
    seedWorkflow(
      `
tasks:
  type: yaml-file
  path: ./target.yml
states:
  todo:
    prompt: Do it
  done:
    terminal: true
`,
      `${cwd}/target.md`
    );

    await runTasks([
      "move",
      "--from",
      `${cwd}/source.md`,
      "--to",
      `${cwd}/target.md`,
      "--dry-run",
      "--state-map",
      "__proto__:done"
    ]);

    expect(taskListMocks.moveTasks).toHaveBeenCalledTimes(1);
    const options = taskListMocks.moveTasks.mock.calls[0]?.[0] as MoveTasksOptions;
    expect(Object.prototype.hasOwnProperty.call(options.stateMap, "__proto__")).toBe(true);
    expect(options.stateMap?.["__proto__"]).toBe("done");
  });

  it("move reports planned dry-run creations with task titles", async () => {
    const logs: string[] = [];
    seedWorkflow(
      `
tasks:
  type: markdown-dir
  path: ./source-tasks
`,
      `${cwd}/source.md`
    );
    seedWorkflow(
      `
tasks:
  type: gh-issues
  repo: acme/repo
  filter: label:bug
  state:
    labelPrefix: "status:"
states:
  draft:
    prompt: Triage it
  done:
    terminal: true
`,
      `${cwd}/target.md`
    );
    taskListMocks.moveTasks.mockImplementationOnce(async (options: MoveTasksOptions) => {
      options.onProgress?.({
        type: "skipped",
        id: "bug-a",
        source: {
          id: "bug-a",
          list: "bugs",
          qualifiedId: "bugs/bug-a",
          name: "First imported bug",
          description: "Details",
          metadata: {},
          state: "draft"
        },
        targetList: "acme/repo",
        targetState: "draft",
        reason: "dry-run"
      });
      return { created: 0, skipped: 1, errors: [] };
    });

    await runTasks(
      ["move", "--from", `${cwd}/source.md`, "--to", `${cwd}/target.md`, "--dry-run"],
      logs
    );

    expect(logs).toEqual(['[dry-run] Would create "First imported bug" as draft.']);
    expect(taskListMocks.moveTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({
          type: "gh-issues",
          stateMachine: expect.objectContaining({ initial: "draft" })
        }),
        onProgress: expect.any(Function)
      })
    );
  });

  it("move reports missing --from or --to clearly", async () => {
    const logs: string[] = [];

    await runTasks(["move", "--to", `${cwd}/target.md`], logs);
    await runTasks(["move", "--from", `${cwd}/source.md`], logs);
    await runTasks(["move", "--from", " ", "--to", `${cwd}/target.md`], logs);
    await runTasks(["move", "--from", `${cwd}/source.md`, "--to", " "], logs);

    expect(logs).toEqual([
      "[error] tasks move requires --from <workflow.md>.",
      "[error] tasks move requires --to <workflow.md>.",
      "[error] tasks move requires --from <workflow.md>.",
      "[error] tasks move requires --to <workflow.md>."
    ]);
    expect(process.exitCode).toBe(2);
    expect(taskListMocks.moveTasks).not.toHaveBeenCalled();
  });

  it.each(["queued:", ":Todo", "queued:Todo,,done:Done", "queued:Todo, ", "queued:Todo:extra"])(
    "move rejects malformed --state-map %s",
    async (stateMap) => {
      const logs: string[] = [];

      await runTasks(
        ["move", "--from", `${cwd}/source.md`, "--to", `${cwd}/target.md`, "--state-map", stateMap],
        logs
      );

      expect(logs).toEqual([
        "[error] --state-map must be comma-separated key:value pairs with non-empty keys and values."
      ]);
      expect(process.exitCode).toBe(2);
      expect(taskListMocks.moveTasks).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["--rate", "0", "--rate must be a positive number."],
    ["--limit", "", "--limit must be a non-negative integer."],
    ["--limit", "-1", "--limit must be a non-negative integer."]
  ])("move rejects invalid numeric flag %s %s", async (flag, value, message) => {
    const logs: string[] = [];

    await runTasks(
      ["move", "--from", `${cwd}/source.md`, "--to", `${cwd}/target.md`, flag, value],
      logs
    );

    expect(logs).toEqual([`[error] ${message}`]);
    expect(process.exitCode).toBe(2);
    expect(taskListMocks.moveTasks).not.toHaveBeenCalled();
  });

  it("import builds a markdown-dir source from --from and keeps source files by default", async () => {
    seedWorkflow(
      `
tasks:
  type: gh-issues
  repo: acme/repo
  filter: label:bug
  state:
    labelPrefix: "status:"
states:
  draft:
    prompt: Triage it
  done:
    terminal: true
`,
      `${cwd}/target.md`
    );

    await runTasks([
      "import",
      "--from",
      `${cwd}/source-dir`,
      "--to",
      `${cwd}/target.md`,
      "--rate",
      "25",
      "--limit",
      "8",
      "--dry-run"
    ]);

    expect(taskListMocks.moveTasks).toHaveBeenCalledWith({
      source: {
        type: "markdown-dir",
        path: `${cwd}/source-dir`,
        singleList: "import",
        frontmatterMode: "passthrough"
      },
      target: {
        type: "gh-issues",
        repo: "acme/repo",
        filter: "label:bug",
        state: { labelPrefix: "status:" },
        stateMachine: {
          initial: "draft",
          states: ["draft", "done"],
          events: {
            draft: { from: "*", to: "draft" },
            done: { from: "*", to: "done" }
          }
        }
      },
      rate: 25,
      limit: 8,
      dryRun: true,
      onProgress: expect.any(Function)
    });
  });

  it("import deletes source files when --delete-source is passed", async () => {
    seedWorkflow(
      `
tasks:
  type: gh-issues
  repo: acme/repo
states:
  draft:
    prompt: Triage it
`,
      `${cwd}/target.md`
    );

    await runTasks([
      "import",
      "--from",
      `${cwd}/source-dir`,
      "--to",
      `${cwd}/target.md`,
      "--delete-source",
      "--yes"
    ]);

    expect(taskListMocks.moveTasks).toHaveBeenCalledWith(
      expect.objectContaining({ deleteSource: true })
    );
  });

  it("import refuses --delete-source without --yes in non-interactive mode", async () => {
    seedWorkflow(
      `
tasks:
  type: gh-issues
  repo: acme/repo
states:
  draft:
    prompt: Triage it
`,
      `${cwd}/target.md`
    );
    const logs: string[] = [];
    const restore = setStdinTTY(false);

    try {
      await runTasks(
        ["import", "--from", `${cwd}/source-dir`, "--to", `${cwd}/target.md`, "--delete-source"],
        logs
      );
    } finally {
      restore();
    }

    expect(taskListMocks.moveTasks).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain(
      "tasks import --delete-source requires --yes when running without an interactive TTY."
    );
  });

  it("move refuses --delete-source without --yes in non-interactive mode", async () => {
    seedWorkflow(
      `
tasks:
  type: markdown-dir
  path: ./source-tasks
`,
      `${cwd}/source.md`
    );
    seedWorkflow(
      `
tasks:
  type: yaml-file
  path: ./target.yml
states:
  draft:
    prompt: Triage it
`,
      `${cwd}/target.md`
    );
    const logs: string[] = [];
    const restore = setStdinTTY(false);

    try {
      await runTasks(
        ["move", "--from", `${cwd}/source.md`, "--to", `${cwd}/target.md`, "--delete-source"],
        logs
      );
    } finally {
      restore();
    }

    expect(taskListMocks.moveTasks).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain(
      "tasks move --delete-source requires --yes when running without an interactive TTY."
    );
  });

  it("import keeps source files when --keep is passed", async () => {
    seedWorkflow(
      `
tasks:
  type: gh-issues
  repo: acme/repo
states:
  draft:
    prompt: Triage it
`,
      `${cwd}/target.md`
    );

    await runTasks([
      "import",
      "--from",
      `${cwd}/source-dir`,
      "--to",
      `${cwd}/target.md`,
      "--keep"
    ]);

    expect(taskListMocks.moveTasks).toHaveBeenCalledWith(
      expect.not.objectContaining({ deleteSource: expect.anything() })
    );
  });

  it("import resolves --from relative to the current working directory", async () => {
    seedWorkflow(
      `
tasks:
  type: gh-issues
  repo: acme/repo
states:
  draft:
    prompt: Triage it
`,
      `${cwd}/target.md`
    );

    await runTasks(["import", "--from", "./bugs-here", "--to", `${cwd}/target.md`]);

    expect(taskListMocks.moveTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({
          type: "markdown-dir",
          path: `${cwd}/bugs-here`
        })
      })
    );
    expect(taskListMocks.moveTasks).toHaveBeenCalledWith(
      expect.not.objectContaining({ deleteSource: expect.anything() })
    );
  });

  it("import rejects conflicting source deletion flags", async () => {
    seedWorkflow(
      `
tasks:
  type: gh-issues
  repo: acme/repo
states:
  draft:
    prompt: Triage it
`,
      `${cwd}/target.md`
    );
    const logs: string[] = [];

    await runTasks(
      [
        "import",
        "--from",
        `${cwd}/source-dir`,
        "--to",
        `${cwd}/target.md`,
        "--keep",
        "--delete-source"
      ],
      logs
    );

    expect(logs).toEqual(["[error] Provide only one of --keep or --delete-source."]);
    expect(process.exitCode).toBe(2);
    expect(taskListMocks.moveTasks).not.toHaveBeenCalled();
  });

  it("import reports missing --from or --to clearly", async () => {
    const logs: string[] = [];

    await runTasks(["import", "--to", `${cwd}/target.md`], logs);
    await runTasks(["import", "--from", `${cwd}/dir`], logs);
    await runTasks(["import", "--from", " ", "--to", `${cwd}/target.md`], logs);
    await runTasks(["import", "--from", `${cwd}/dir`, "--to", " "], logs);

    expect(logs).toEqual([
      "[error] tasks import requires --from <source-dir>.",
      "[error] tasks import requires --to <workflow.md>.",
      "[error] tasks import requires --from <source-dir>.",
      "[error] tasks import requires --to <workflow.md>."
    ]);
    expect(process.exitCode).toBe(2);
    expect(taskListMocks.moveTasks).not.toHaveBeenCalled();
  });

  it.each([
    ["--rate", "0", "--rate must be a positive number."],
    ["--limit", "-1", "--limit must be a non-negative integer."]
  ])("import rejects invalid numeric flag %s %s", async (flag, value, message) => {
    const logs: string[] = [];

    await runTasks(
      ["import", "--from", `${cwd}/dir`, "--to", `${cwd}/target.md`, flag, value],
      logs
    );

    expect(logs).toEqual([`[error] ${message}`]);
    expect(process.exitCode).toBe(2);
    expect(taskListMocks.moveTasks).not.toHaveBeenCalled();
  });

  it("get prints a task field with a trailing newline", async () => {
    seedTaskWorkspace({ description: "Field body" });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    try {
      await runTasks(["get", "plans/foo", "--field", "description"]);
      expect(stdout).toHaveBeenCalledWith("Field body\n");
      expect(process.exitCode).toBeUndefined();
    } finally {
      stdout.mockRestore();
    }
  });

  it("get exits non-zero when the task is missing", async () => {
    seedTaskWorkspace();
    const logs: string[] = [];

    await runTasks(["get", "plans/missing"], logs);

    expect(process.exitCode).toBe(1);
    expect(logs[0]).toContain("not found");
  });

  it("set updates name, description, and metadata", async () => {
    seedTaskWorkspace();

    await runTasks([
      "set",
      "plans/foo",
      "--name",
      "Renamed",
      "--description",
      "Updated description",
      "--metadata-json",
      '{"owner":"agent"}'
    ]);

    const content = vol.readFileSync(`${cwd}/tasks/plans/foo.md`, "utf8");
    expect(content).toContain("name: Renamed");
    expect(content).toContain("owner: agent");
    expect(content).toContain("Updated description");
  });

  it("set rejects empty updates without rewriting markdown tasks", async () => {
    seedTaskWorkspace();
    const before = vol.readFileSync(`${cwd}/tasks/plans/foo.md`, "utf8");
    const logs: string[] = [];

    await runTasks(["set", "plans/foo"], logs);

    expect(process.exitCode).toBe(2);
    expect(logs).toEqual([
      "[error] Provide at least one of --name, --description, --description-file, or --metadata-json."
    ]);
    expect(vol.readFileSync(`${cwd}/tasks/plans/foo.md`, "utf8")).toBe(before);
  });

  it("set rejects both --description-file and --description together", async () => {
    seedTaskWorkspace();
    vol.writeFileSync(`${cwd}/body.md`, "from file");
    const logs: string[] = [];

    await runTasks(
      ["set", "plans/foo", "--description-file", `${cwd}/body.md`, "--description", "inline"],
      logs
    );

    expect(process.exitCode).toBe(2);
    expect(logs).toEqual([
      "[error] Provide exactly one of --description-file or --description when updating description."
    ]);
  });

  it("set rejects malformed metadata JSON as a usage error", async () => {
    seedTaskWorkspace();
    const logs: string[] = [];

    await runTasks(["set", "plans/foo", "--metadata-json", "{"], logs);

    expect(process.exitCode).toBe(2);
    expect(logs).toEqual(["[error] --metadata-json must be valid JSON."]);
  });

  it("set previews updates without mutating markdown tasks", async () => {
    seedTaskWorkspace();
    const before = vol.readFileSync(`${cwd}/tasks/plans/foo.md`, "utf8");
    const logs: string[] = [];

    await runTasks(["--dry-run", "set", "plans/foo", "--name", "Renamed"], logs);

    expect(vol.readFileSync(`${cwd}/tasks/plans/foo.md`, "utf8")).toBe(before);
    expect(logs).toEqual(["[dry-run] Would update task plans/foo."]);
  });

  it("set-state moves directly to a declared state", async () => {
    seedTaskWorkspace({ state: "queued" });

    await runTasks(["set-state", "plans/foo", "done"]);

    const content = vol.readFileSync(`${cwd}/tasks/plans/foo.md`, "utf8");
    expect(content).toContain("state: done");
    expect(process.exitCode).toBeUndefined();
  });

  it("set-state previews transitions without mutating markdown tasks", async () => {
    seedTaskWorkspace({ state: "queued" });
    const before = vol.readFileSync(`${cwd}/tasks/plans/foo.md`, "utf8");
    const logs: string[] = [];

    await runTasks(["--dry-run", "set-state", "plans/foo", "done"], logs);

    expect(vol.readFileSync(`${cwd}/tasks/plans/foo.md`, "utf8")).toBe(before);
    expect(logs).toEqual(["[dry-run] Would set task plans/foo state to done."]);
  });

  it("set-state to an undeclared state exits 2 with declared states", async () => {
    seedTaskWorkspace();
    const logs: string[] = [];

    await runTasks(["set-state", "plans/foo", "blocked"], logs);

    expect(process.exitCode).toBe(2);
    expect(logs).toEqual([
      '[error] target state "blocked" is not declared in WORKFLOW.md; declared states: queued, agent-running, done'
    ]);
  });

  it("next advances from the current state to the next declared state", async () => {
    seedTaskWorkspace({ state: "queued" });

    await runTasks(["next", "plans/foo"]);

    const content = vol.readFileSync(`${cwd}/tasks/plans/foo.md`, "utf8");
    expect(content).toContain("state: agent-running");
  });

  it("next previews transitions without mutating markdown tasks", async () => {
    seedTaskWorkspace({ state: "queued" });
    const before = vol.readFileSync(`${cwd}/tasks/plans/foo.md`, "utf8");
    const logs: string[] = [];

    await runTasks(["--dry-run", "next", "plans/foo"], logs);

    expect(vol.readFileSync(`${cwd}/tasks/plans/foo.md`, "utf8")).toBe(before);
    expect(logs).toEqual(["[dry-run] Would set task plans/foo state to agent-running."]);
  });

  it("next at the last state exits 2 with the documented message", async () => {
    seedTaskWorkspace({ state: "done" });
    const logs: string[] = [];

    await runTasks(["next", "plans/foo"], logs);

    expect(process.exitCode).toBe(2);
    expect(logs).toEqual(["[error] no state after `done`; use `set-state` to override"]);
  });

  it("next exits 2 when the current state is no longer declared", async () => {
    seedTaskWorkspace({
      state: "removed",
      workflowFrontmatter: `
tasks:
  type: markdown-dir
  path: ${cwd}/tasks
states:
  queued:
    prompt: Run it
  done:
    terminal: true
`
    });
    const logs: string[] = [];

    await runTasks(["next", "plans/foo"], logs);

    expect(process.exitCode).toBe(2);
    expect(logs).toEqual([
      "[error] current state is not declared in WORKFLOW.md; declared states: queued, done"
    ]);
  });

  const gateWorkflow = `
tasks:
  type: markdown-dir
  path: ${cwd}/tasks
states:
  idea:
    prompt: Plan
  awaiting-build:
    gate: true
  build:
    prompt: Build
  done:
    terminal: true
`;

  it("next refuses to advance out of a gate state", async () => {
    seedTaskWorkspace({ state: "awaiting-build", workflowFrontmatter: gateWorkflow });
    const before = vol.readFileSync(`${cwd}/tasks/plans/foo.md`, "utf8");
    const logs: string[] = [];

    await runTasks(["next", "plans/foo"], logs);

    expect(process.exitCode).toBe(2);
    expect(vol.readFileSync(`${cwd}/tasks/plans/foo.md`, "utf8")).toBe(before);
    expect(logs.some((line) => line.includes("awaiting-build") && line.includes("gate"))).toBe(true);
  });

  it("next --force advances out of a gate state", async () => {
    seedTaskWorkspace({ state: "awaiting-build", workflowFrontmatter: gateWorkflow });

    await runTasks(["next", "plans/foo", "--force"]);

    expect(vol.readFileSync(`${cwd}/tasks/plans/foo.md`, "utf8")).toContain("state: build");
    expect(process.exitCode).toBeUndefined();
  });

  it("set-state refuses to skip over a gate state", async () => {
    seedTaskWorkspace({ state: "idea", workflowFrontmatter: gateWorkflow });
    const before = vol.readFileSync(`${cwd}/tasks/plans/foo.md`, "utf8");
    const logs: string[] = [];

    await runTasks(["set-state", "plans/foo", "build"], logs);

    expect(process.exitCode).toBe(2);
    expect(vol.readFileSync(`${cwd}/tasks/plans/foo.md`, "utf8")).toBe(before);
    expect(logs.some((line) => line.includes("awaiting-build") && line.includes("gate"))).toBe(true);
  });

  it("comment against markdown-dir exits 2 with the documented message", async () => {
    seedTaskWorkspace();
    const logs: string[] = [];

    await runTasks(["comment", "plans/foo", "--message", "Looks good"], logs);

    expect(process.exitCode).toBe(2);
    expect(logs).toEqual(["[error] comment is unsupported on the markdown-dir task backend"]);
  });

  it("comment against markdown-dir reports unsupported before reading a file", async () => {
    seedTaskWorkspace();
    const logs: string[] = [];

    await runTasks(["comment", "plans/foo", "--file", `${cwd}/missing.md`], logs);

    expect(process.exitCode).toBe(2);
    expect(logs).toEqual(["[error] comment is unsupported on the markdown-dir task backend"]);
  });

  it("comment rejects missing message sources", async () => {
    seedTaskWorkspace();
    const logs: string[] = [];

    await runTasks(["comment", "plans/foo"], logs);

    expect(process.exitCode).toBe(2);
    expect(logs).toEqual(["[error] Provide exactly one of --file or --message."]);
  });

  it("comment against gh-issues posts through the backend comment method", async () => {
    seedWorkflow(`
tasks:
  type: gh-issues
  repo: octo/repo
  project:
    owner: octo-org
    number: 7
  auth:
    token: test-token
states:
  Todo:
    prompt: Run it
  Done:
    terminal: true
`);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(graphqlResponse(projectData()))
      .mockResolvedValueOnce(
        graphqlResponse({
          repository: {
            issue: {
              id: "issue-node-42",
              number: 42,
              title: "Issue task",
              body: "Body",
              url: "https://github.test/octo/repo/issues/42",
              createdAt: "2026-01-01T00:00:00Z",
              labels: { nodes: [] },
              assignees: { nodes: [] },
              milestone: null,
              projectItems: {
                nodes: [
                  {
                    id: "item-42",
                    project: { id: "project-id" },
                    fieldValueByName: { name: "Todo" }
                  }
                ]
              }
            }
          }
        })
      )
      .mockResolvedValueOnce(
        graphqlResponse({
          repository: {
            issue: {
              id: "issue-node-42",
              number: 42,
              title: "Issue task",
              body: "Body",
              url: "https://github.test/octo/repo/issues/42",
              createdAt: "2026-01-01T00:00:00Z",
              labels: { nodes: [] },
              assignees: { nodes: [] },
              milestone: null,
              projectItems: {
                nodes: [
                  {
                    id: "item-42",
                    project: { id: "project-id" },
                    fieldValueByName: { name: "Todo" }
                  }
                ]
              }
            }
          }
        })
      )
      .mockResolvedValueOnce(
        graphqlResponse({
          addComment: {
            commentEdge: {
              node: {
                id: "comment-1"
              }
            }
          }
        })
      );

    try {
      await runTasks(["comment", "octo-org/7#42", "--message", "Ship it"]);

      expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).query)).toEqual([
        expect.stringContaining("query Project"),
        expect.stringContaining("query Issue"),
        expect.stringContaining("query Issue"),
        expect.stringContaining("mutation AddComment")
      ]);
      const body = JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body)) as {
        query: string;
        variables: { input: { subjectId: string; body: string } };
      };
      expect(body.query).toContain("mutation AddComment");
      expect(body.variables.input).toEqual({
        subjectId: "issue-node-42",
        body: "Ship it"
      });
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("comment previews GitHub issue comments without posting mutations", async () => {
    seedWorkflow(`
tasks:
  type: gh-issues
  repo: octo/repo
  project:
    owner: octo-org
    number: 7
  auth:
    token: test-token
states:
  Todo:
    prompt: Run it
  Done:
    terminal: true
`);
    const logs: string[] = [];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(graphqlResponse(projectData()))
      .mockResolvedValueOnce(
        graphqlResponse({
          repository: {
            issue: {
              number: 42,
              title: "Issue task",
              body: "Body",
              url: "https://github.test/octo/repo/issues/42",
              createdAt: "2026-01-01T00:00:00Z",
              labels: { nodes: [] },
              assignees: { nodes: [] },
              milestone: null,
              projectItems: { nodes: [{ id: "item-42", project: { id: "project-id" }, fieldValueByName: { name: "Todo" } }] }
            }
          }
        })
      );

    try {
      await runTasks(["--dry-run", "comment", "octo-org/7#42", "--message", "Ship it"], logs);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(logs).toEqual(["[dry-run] Would comment on task octo-org/7#42."]);
    } finally {
      fetchMock.mockRestore();
    }
  });
});

function graphqlResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function projectData(): unknown {
  return {
    organization: {
      projectV2: {
        id: "project-id",
        title: "Roadmap",
        field: {
          id: "status-field",
          options: [
            { id: "status-todo", name: "Todo" },
            { id: "status-done", name: "Done" }
          ]
        }
      }
    },
    user: null
  };
}
