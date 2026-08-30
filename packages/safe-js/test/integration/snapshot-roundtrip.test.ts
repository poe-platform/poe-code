import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";
import type { SandboxClosure, SandboxValue } from "../../src/interp/values.js";
import type { ParseResult } from "../../src/parse/parser.js";
import type { RuntimeSnapshotValue } from "../../src/snapshot/serialize.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { fs } = await import("memfs");
const { Budget } = await import("../../src/interp/budget.js");
const { isSandboxPromise } = await import("../../src/interp/values.js");
const { makeAgentModule } = await import("../../src/modules/agent.js");
const { makeHarnessModule } = await import("../../src/modules/harness.js");
const { parseModule } = await import("../../src/parse/parser.js");
const { run } = await import("../../src/run.js");
const { restore } = await import("../../src/snapshot/restore.js");
const { serialize } = await import("../../src/snapshot/serialize.js");

describe("snapshot roundtrip integration", () => {
  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("restores a 3-task pipeline mid-loop without replaying completed side effects", async () => {
    await expectSnapshotRoundtrip({
      completedTaskCount: 2,
      expectedCommitsBeforeRestore: ["commit:task-1", "commit:task-2"],
      expectedSpawnsBeforeRestore: [
        "build:task-1:inspect",
        "review:task-1",
        "build:task-2:implement",
        "review:task-2"
      ]
    });
  });

  it("resumes cleanly from an earlier mid-loop snapshot without replaying finished work", async () => {
    await expectSnapshotRoundtrip({
      completedTaskCount: 1,
      expectedCommitsBeforeRestore: ["commit:task-1"],
      expectedSpawnsBeforeRestore: ["build:task-1:inspect", "review:task-1"]
    });
  });
});

const source = [
  'import * as agent from "agent";',
  'import * as git from "git";',
  'import * as harness from "harness";',
  "",
  "return async (task) => ({",
  "  id: task.id,",
  "  build: await agent.spawn(harness.agents.builder, {",
  '    prompt: "build:".concat(task.id).concat(":").concat(task.prompt)',
  "  }),",
  "  review: await agent.spawn(harness.agents.reviewer, {",
  '    prompt: "review:".concat(task.id)',
  "  }),",
  "  commitId: await git.commit({",
  '    message: "commit:".concat(task.id),',
  '    files: ["tasks/".concat(task.id).concat(".txt")]',
  "  })",
  "});"
].join("\n");

const frontmatter = {
  kind: "pipeline",
  version: 1,
  agents: {
    builder: {
      agent: "stub-builder",
      mode: "edit"
    },
    reviewer: {
      agent: "stub-reviewer",
      mode: "read"
    }
  },
  tasks: [
    {
      id: "task-1",
      prompt: "inspect"
    },
    {
      id: "task-2",
      prompt: "implement"
    },
    {
      id: "task-3",
      prompt: "verify"
    }
  ]
} as const;

async function expectSnapshotRoundtrip(input: {
  completedTaskCount: number;
  expectedCommitsBeforeRestore: string[];
  expectedSpawnsBeforeRestore: string[];
}): Promise<void> {
  const firstProcessModules = createModules(frontmatter);
  const firstRun = await run(source, {
    modules: firstProcessModules
  });

  expect(firstRun.ok).toBe(true);
  if (!firstRun.ok) {
    return;
  }

  const runTask = firstRun.returnValue as SandboxClosure;
  let current: RuntimeSnapshotValue = {
    index: 0,
    completed: []
  };

  for (const task of frontmatter.tasks.slice(0, input.completedTaskCount)) {
    current = await runPipelineTask(runTask, task as RuntimeSnapshotValue, current);
  }

  await expect(readSpawnPrompts()).resolves.toEqual(input.expectedSpawnsBeforeRestore);
  await expect(readCommitMessages()).resolves.toEqual(input.expectedCommitsBeforeRestore);

  const stepNodeId = getStepClosureNodeId(source);
  const serializedSnapshot = serialize({
    source,
    currentAstNodeId: stepNodeId,
    scopeChain: [
      {
        id: "module",
        bindings: {
          current,
          runTask: {
            kind: "fn",
            astNodeId: stepNodeId,
            capturedScopeId: "module"
          }
        }
      }
    ],
    callStack: [],
    pendingPromises: [],
    moduleBindings: {
      agent: "agent",
      git: "git",
      harness: "harness"
    }
  });

  await fs.promises.mkdir("/snapshots", { recursive: true });
  await fs.promises.writeFile(
    "/snapshots/pipeline.json",
    JSON.stringify(serializedSnapshot, null, 2)
  );

  const secondProcessModules = createModules(frontmatter);
  const dumpedSnapshot = JSON.parse(
    await fs.promises.readFile("/snapshots/pipeline.json", "utf8")
  ) as Parameters<typeof restore>[0];
  const restored = restore(dumpedSnapshot, {
    budget: new Budget(),
    modules: secondProcessModules,
    source
  });

  const restoredCurrent = restored.currentScope.lookup("current");
  const restoredStep = restored.currentScope.lookup("runTask");

  expect(restoredCurrent.found).toBe(true);
  expect(restoredStep.found).toBe(true);
  if (!restoredCurrent.found || !restoredStep.found) {
    return;
  }

  current = restoredCurrent.value as RuntimeSnapshotValue;
  const resumedStep = restoredStep.value;

  expect(typeof resumedStep).toBe("object");
  expect(resumedStep).toMatchObject({
    kind: "fn",
    astNodeId: stepNodeId,
    capturedScopeId: "module"
  });
  if (!isSandboxClosureLike(resumedStep)) {
    return;
  }

  for (const task of frontmatter.tasks.slice((current as { index: number }).index)) {
    current = await runPipelineTask(resumedStep, task as RuntimeSnapshotValue, current);
  }

  expect(current).toEqual({
    index: 3,
    completed: [
      {
        id: "task-1",
        build: "stub-builder|build:task-1:inspect",
        review: "stub-reviewer|review:task-1",
        commitId: "commit-1"
      },
      {
        id: "task-2",
        build: "stub-builder|build:task-2:implement",
        review: "stub-reviewer|review:task-2",
        commitId: "commit-2"
      },
      {
        id: "task-3",
        build: "stub-builder|build:task-3:verify",
        review: "stub-reviewer|review:task-3",
        commitId: "commit-3"
      }
    ]
  });

  await expect(readSpawnPrompts()).resolves.toEqual([
    "build:task-1:inspect",
    "review:task-1",
    "build:task-2:implement",
    "review:task-2",
    "build:task-3:verify",
    "review:task-3"
  ]);
  await expect(readCommitMessages()).resolves.toEqual([
    "commit:task-1",
    "commit:task-2",
    "commit:task-3"
  ]);
  await expect(readTaskCommit("task-1")).resolves.toBe("commit:1:commit:task-1");
  await expect(readTaskCommit("task-2")).resolves.toBe("commit:2:commit:task-2");
  await expect(readTaskCommit("task-3")).resolves.toBe("commit:3:commit:task-3");
}

function createModules(frontmatter: {
  kind: string;
  version: number;
  agents: Record<string, { agent: string; mode: string }>;
  tasks: Array<{ id: string; prompt: string }>;
}) {
  const agent = makeAgentModule(async (input) => {
    const prompts = await readJsonFile<string[]>("/side-effects/spawns.json", []);
    prompts.push(input.prompt);
    await writeJsonFile("/side-effects/spawns.json", prompts);

    return {
      durationMs: 1,
      exitCode: 0,
      stderr: "",
      stdout: "",
      summary: `${input.agent}|${input.prompt}`
    };
  });
  const harness = makeHarnessModule(frontmatter, {
    filepath: "/repo/docs/plans/pipeline.md",
    kind: frontmatter.kind,
    version: frontmatter.version
  });

  return {
    agent,
    git: {
      async commit(input: { message: string; files: string[] }) {
        const commits = await readJsonFile<string[]>("/side-effects/commits.json", []);
        commits.push(input.message);
        await writeJsonFile("/side-effects/commits.json", commits);

        const commitNumber = commits.length;
        const targetPath = normalizeRepoPath(input.files[0] as string);
        await fs.promises.mkdir(dirname(targetPath), { recursive: true });
        await fs.promises.writeFile(targetPath, `commit:${commitNumber}:${input.message}`);
        return `commit-${commitNumber}`;
      }
    },
    harness
  };
}

async function runPipelineTask(
  runTask: SandboxClosure,
  task: RuntimeSnapshotValue,
  current: RuntimeSnapshotValue
): Promise<RuntimeSnapshotValue> {
  const result = runTask.call([task]);

  expect(isSandboxPromise(result)).toBe(true);
  if (!isSandboxPromise(result)) {
    throw new TypeError("Expected pipeline step to return a sandbox promise.");
  }

  const completedTask = await result.promise;
  return {
    index: (current as { index: number }).index + 1,
    completed: (current as { completed: RuntimeSnapshotValue[] }).completed.concat({
      id: (completedTask as { id: string }).id,
      build: (completedTask as { build: { summary: string } }).build.summary,
      review: (completedTask as { review: { summary: string } }).review.summary,
      commitId: (completedTask as { commitId: string }).commitId
    })
  };
}

async function readSpawnPrompts(): Promise<string[]> {
  return readJsonFile("/side-effects/spawns.json", []);
}

async function readCommitMessages(): Promise<string[]> {
  return readJsonFile("/side-effects/commits.json", []);
}

async function readTaskCommit(taskId: string): Promise<string> {
  return await fs.promises.readFile(`/repo/tasks/${taskId}.txt`, "utf8");
}

async function readJsonFile<TValue>(filepath: string, fallback: TValue): Promise<TValue> {
  if (!vol.existsSync(filepath)) {
    return fallback;
  }

  return JSON.parse(await fs.promises.readFile(filepath, "utf8")) as TValue;
}

async function writeJsonFile(filepath: string, value: unknown): Promise<void> {
  await fs.promises.mkdir(dirname(filepath), { recursive: true });
  await fs.promises.writeFile(filepath, JSON.stringify(value, null, 2));
}

function dirname(filepath: string): string {
  const segments = filepath.split("/");
  segments.pop();
  const joined = segments.join("/");
  return joined.length === 0 ? "/" : joined;
}

function normalizeRepoPath(filepath: string): string {
  return filepath.startsWith("/") ? filepath : `/repo/${filepath}`;
}

function getStepClosureNodeId(source: string): number {
  return findNodeByType(parseModule(source), "ArrowFunctionExpression").nodeId;
}

function findNodeByType(root: unknown, type: ParseResult["type"]): ParseResult {
  if (Array.isArray(root)) {
    for (const entry of root) {
      const found = findNodeByTypeOrUndefined(entry, type);
      if (found !== undefined) {
        return found;
      }
    }
  }

  const found = findNodeByTypeOrUndefined(root, type);
  if (found === undefined) {
    throw new Error(`AST node ${type} not found.`);
  }

  return found;
}

function findNodeByTypeOrUndefined(
  root: unknown,
  type: ParseResult["type"]
): ParseResult | undefined {
  if (typeof root !== "object" || root === null) {
    return undefined;
  }

  if ("type" in root && root.type === type && "nodeId" in root && typeof root.nodeId === "number") {
    return root as ParseResult;
  }

  for (const entry of Object.values(root)) {
    const found = findNodeByTypeOrUndefined(entry, type);
    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

function isSandboxClosureLike(value: SandboxValue | unknown): value is SandboxClosure {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "fn" &&
    "call" in value
  );
}
