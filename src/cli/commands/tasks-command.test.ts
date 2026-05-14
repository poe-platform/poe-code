import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol, fs as memfs } from "memfs";
import { Command } from "commander";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";
import type { SyncGhProjectReport, VerifyGhProjectReport } from "@poe-code/task-list";

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
    syncGhProject: vi.fn(),
    verifyGhProject: vi.fn()
  };
});

vi.mock("@poe-code/task-list", () => taskListMocks);

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
      workflowPath: "./WORKFLOW.md",
      yes: true
    });
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

  it("sync permits interactive runs without --yes", async () => {
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
    expect(taskListMocks.syncGhProject).toHaveBeenCalledWith(
      expect.objectContaining({ yes: false })
    );
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
});
