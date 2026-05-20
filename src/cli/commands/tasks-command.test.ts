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

vi.mock("@poe-code/task-list", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/task-list")>();
  return {
    ...actual,
    GhProjectSyncError: taskListMocks.GhProjectSyncError,
    syncGhProject: taskListMocks.syncGhProject,
    verifyGhProject: taskListMocks.verifyGhProject
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

  it("set-state moves directly to a declared state", async () => {
    seedTaskWorkspace({ state: "queued" });

    await runTasks(["set-state", "plans/foo", "done"]);

    const content = vol.readFileSync(`${cwd}/tasks/plans/foo.md`, "utf8");
    expect(content).toContain("state: done");
    expect(process.exitCode).toBeUndefined();
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
              id: "issue-node-42"
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

      expect(fetchMock).toHaveBeenCalledTimes(4);
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
