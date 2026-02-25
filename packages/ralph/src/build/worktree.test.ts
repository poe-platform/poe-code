import { describe, it, expect, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { stringify } from "yaml";
import type { FileSystem } from "../../../../src/utils/file-system.js";
import { parsePlan } from "../plan/parser.js";
import { buildLoop } from "./loop.js";

function createMemFs(files: Record<string, string> = {}): FileSystem & {
  copyFile(src: string, dest: string): Promise<void>;
  symlink(target: string, path: string): Promise<void>;
  lstat(path: string): Promise<{ isSymbolicLink(): boolean }>;
} {
  const vol = Volume.fromJSON(files, "/");
  const promises = createFsFromVolume(vol).promises;
  const fs = promises as unknown as FileSystem;
  return {
    ...fs,
    async copyFile(src: string, dest: string): Promise<void> {
      const content = await promises.readFile(src, "utf8");
      await promises.writeFile(dest, content);
    },
    async symlink(target: string, path: string): Promise<void> {
      await promises.symlink(target, path);
    },
    async lstat(path: string): Promise<{ isSymbolicLink(): boolean }> {
      const stat = await promises.lstat(path);
      return stat as { isSymbolicLink(): boolean };
    }
  };
}

const noLock = async () => async () => {};

const planYaml = stringify({
  version: 1,
  project: "Test",
  goals: [],
  nonGoals: [],
  qualityGates: ["npm run test"],
  stories: [
    {
      id: "US-001",
      title: "Do the thing",
      status: "open",
      dependsOn: [],
      description: "As a user, I want a thing.",
      acceptanceCriteria: ["Criterion A"]
    }
  ]
});

function createWorktreeFs() {
  return createMemFs({
    "/.agents/poe-code-ralph/PROMPT_build.md": [
      "# Test Prompt",
      "ID: {{STORY_ID}}",
      "{{STORY_BLOCK}}",
      "Run: {{RUN_ID}} Iter: {{ITERATION}}",
      ""
    ].join("\n"),
    "/.poe-code-ralph/errors.log": "",
    "/.agents/tasks/plan-build-worktree.yaml": planYaml
  });
}

const PROMPT_TEMPLATE = [
  "# Test Prompt",
  "ID: {{STORY_ID}}",
  "{{STORY_BLOCK}}",
  "Run: {{RUN_ID}} Iter: {{ITERATION}}",
  ""
].join("\n");

function createWorktreeDeps(
  fs: ReturnType<typeof createMemFs>,
  opts?: { gitignored?: string[] }
) {
  const execCalls: { command: string; cwd?: string }[] = [];
  const gitignored = new Set(opts?.gitignored ?? [".poe-code-ralph", ".agents/poe-code-ralph"]);

  return {
    deps: {
      fs: {
        readFile: (p: string, enc: BufferEncoding) => fs.readFile(p, enc),
        writeFile: (p: string, data: string, opts?: { encoding?: BufferEncoding }) =>
          fs.writeFile(p, data, opts),
        mkdir: (p: string, opts?: { recursive?: boolean }) => fs.mkdir(p, opts)
      },
      exec: async (command: string, options?: { cwd?: string }) => {
        execCalls.push({ command, cwd: options?.cwd });

        // Simulate git worktree add: create the worktree directory
        // Non-gitignored dirs are checked out; gitignored ones are absent
        if (command.startsWith("git worktree add")) {
          const parts = command.split(" ");
          const pathIndex = parts.indexOf("-b") + 2;
          const worktreePath = parts[pathIndex] ?? "";
          if (worktreePath) {
            await fs.mkdir(worktreePath, { recursive: true });
            // Simulate checkout of non-gitignored files
            if (!gitignored.has(".agents/poe-code-ralph")) {
              await fs.mkdir(`${worktreePath}/.agents/poe-code-ralph`, {
                recursive: true
              });
              await fs.writeFile(
                `${worktreePath}/.agents/poe-code-ralph/PROMPT_build.md`,
                PROMPT_TEMPLATE,
                { encoding: "utf8" }
              );
            }
          }
        }

        // Simulate git check-ignore: succeed for gitignored paths, fail otherwise
        if (command.startsWith("git check-ignore")) {
          const path = command.split(" ").pop() ?? "";
          if (!gitignored.has(path)) {
            throw new Error(`pathspec '${path}' did not match any file(s) known to git`);
          }
        }

        return { stdout: "", stderr: "" };
      }
    },
    execCalls
  };
}

describe("buildLoop with worktree", () => {
  it("creates a worktree, copies plan, and runs build with worktree cwd", async () => {
    const fs = createWorktreeFs();
    const { deps: worktreeDeps, execCalls } = createWorktreeDeps(fs);
    const runId = "test-run-wt";

    let capturedCwd = "";
    const spawn = vi.fn(async (_agent: string, options: { prompt: string; cwd?: string }) => {
      capturedCwd = options.cwd ?? "";
      return {
        stdout: "<promise>COMPLETE</promise>",
        stderr: "",
        exitCode: 0
      };
    });

    let stdoutOutput = "";
    const stdout = { write: (chunk: string) => { stdoutOutput += chunk; } };

    const result = await buildLoop({
      planPath: ".agents/tasks/plan-build-worktree.yaml",
      maxIterations: 3,
      commit: false,
      agent: "codex",
      staleSeconds: 0,
      cwd: "/",
      worktree: { enabled: true },
      deps: {
        fs,
        lock: noLock,
        runId,
        spawn,
        stdout,
        stderr: { write: () => {} },
        worktree: worktreeDeps,
        git: {
          getHead: () => null,
          getCommitList: () => [],
          getChangedFiles: () => [],
          getDirtyFiles: () => [],
          getCurrentBranch: () => "main"
        },
        now: () => new Date("2026-02-02T06:00:00.000Z")
      }
    });

    // Worktree was created via exec
    const createCmd = execCalls.find((c) => c.command.includes("git worktree add"));
    expect(createCmd).toBeDefined();
    expect(createCmd?.command).toContain("poe-code/plan-build-worktree");
    expect(createCmd?.command).toContain("main");

    // Build ran inside the worktree directory
    expect(capturedCwd).toContain(".poe-code-ralph/worktrees/plan-build-worktree");

    // Plan was copied into the worktree
    const worktreePlanPath =
      "/.poe-code-ralph/worktrees/plan-build-worktree/.agents/tasks/plan-build-worktree.yaml";
    const copiedPlan = await fs.readFile(worktreePlanPath, "utf8");
    expect(copiedPlan).toContain("US-001");

    // Story was marked done in the worktree plan
    const updated = parsePlan(copiedPlan);
    expect(updated.stories[0]?.status).toBe("done");

    // Result includes worktree branch
    expect(result.worktreeBranch).toBe("poe-code/plan-build-worktree");
    expect(result.storiesDone).toEqual(["US-001"]);

    // Merge command was printed
    expect(stdoutOutput).toContain("poe-code/plan-build-worktree");
    expect(stdoutOutput).toContain("git merge");

    // Gitignored directories were symlinked into the worktree
    const poeCodeRalphStat = await fs.lstat(
      "/.poe-code-ralph/worktrees/plan-build-worktree/.poe-code-ralph"
    );
    expect(poeCodeRalphStat.isSymbolicLink()).toBe(true);

    const agentsStat = await fs.lstat(
      "/.poe-code-ralph/worktrees/plan-build-worktree/.agents/poe-code-ralph"
    );
    expect(agentsStat.isSymbolicLink()).toBe(true);

    // Worktree registry was updated to "done"
    const registryContent = await fs.readFile(
      "/.poe-code-ralph/worktrees.yaml",
      "utf8"
    );
    expect(registryContent).toContain("done");
  });

  it("does not symlink directories that are not gitignored", async () => {
    const fs = createWorktreeFs();
    const { deps: worktreeDeps } = createWorktreeDeps(fs, { gitignored: [] });
    const runId = "test-run-no-symlink";

    const spawn = vi.fn(async () => ({
      stdout: "<promise>COMPLETE</promise>",
      stderr: "",
      exitCode: 0
    }));

    await buildLoop({
      planPath: ".agents/tasks/plan-build-worktree.yaml",
      maxIterations: 3,
      commit: false,
      agent: "codex",
      staleSeconds: 0,
      cwd: "/",
      worktree: { enabled: true },
      deps: {
        fs,
        lock: noLock,
        runId,
        spawn,
        stdout: { write: () => {} },
        stderr: { write: () => {} },
        worktree: worktreeDeps,
        git: {
          getHead: () => null,
          getCommitList: () => [],
          getChangedFiles: () => [],
          getDirtyFiles: () => [],
          getCurrentBranch: () => "main"
        },
        now: () => new Date("2026-02-02T06:00:00.000Z")
      }
    });

    // .poe-code-ralph should NOT be symlinked (not gitignored)
    let isSymlink = false;
    try {
      const stat = await fs.lstat(
        "/.poe-code-ralph/worktrees/plan-build-worktree/.poe-code-ralph"
      );
      isSymlink = stat.isSymbolicLink();
    } catch {
      // doesn't exist at all, which is fine
    }
    expect(isSymlink).toBe(false);
  });

  it("updates worktree status to failed on build failure", async () => {
    const fs = createWorktreeFs();
    const { deps: worktreeDeps } = createWorktreeDeps(fs);
    const runId = "test-run-fail";

    const spawn = vi.fn(async () => ({
      stdout: "crash",
      stderr: "boom\n",
      exitCode: 1
    }));

    let stdoutOutput = "";
    const stdout = { write: (chunk: string) => { stdoutOutput += chunk; } };

    const result = await buildLoop({
      planPath: ".agents/tasks/plan-build-worktree.yaml",
      maxIterations: 1,
      commit: false,
      agent: "codex",
      staleSeconds: 0,
      cwd: "/",
      worktree: { enabled: true },
      deps: {
        fs,
        lock: noLock,
        runId,
        spawn,
        stdout,
        stderr: { write: () => {} },
        worktree: worktreeDeps,
        git: {
          getHead: () => null,
          getCommitList: () => [],
          getChangedFiles: () => [],
          getDirtyFiles: () => [],
          getCurrentBranch: () => "main"
        },
        now: () => new Date("2026-02-02T06:00:00.000Z")
      }
    });

    expect(result.storiesDone).toEqual([]);
    expect(result.worktreeBranch).toBe("poe-code/plan-build-worktree");

    // Worktree registry was updated to "failed"
    const registryContent = await fs.readFile(
      "/.poe-code-ralph/worktrees.yaml",
      "utf8"
    );
    expect(registryContent).toContain("failed");

    // Merge hint still printed (with branch info)
    expect(stdoutOutput).toContain("poe-code/plan-build-worktree");
  });

  it("uses custom worktree name when provided", async () => {
    const fs = createWorktreeFs();
    const { deps: worktreeDeps, execCalls } = createWorktreeDeps(fs);
    const runId = "test-run-custom-name";

    const spawn = vi.fn(async () => ({
      stdout: "<promise>COMPLETE</promise>",
      stderr: "",
      exitCode: 0
    }));

    const result = await buildLoop({
      planPath: ".agents/tasks/plan-build-worktree.yaml",
      maxIterations: 3,
      commit: false,
      agent: "codex",
      staleSeconds: 0,
      cwd: "/",
      worktree: { enabled: true, name: "my-custom-worktree" },
      deps: {
        fs,
        lock: noLock,
        runId,
        spawn,
        stdout: { write: () => {} },
        stderr: { write: () => {} },
        worktree: worktreeDeps,
        git: {
          getHead: () => null,
          getCommitList: () => [],
          getChangedFiles: () => [],
          getDirtyFiles: () => [],
          getCurrentBranch: () => "main"
        },
        now: () => new Date("2026-02-02T06:00:00.000Z")
      }
    });

    // Custom name was used for the branch
    expect(result.worktreeBranch).toBe("poe-code/my-custom-worktree");

    // Git command used custom name
    const createCmd = execCalls.find((c) => c.command.includes("git worktree add"));
    expect(createCmd?.command).toContain("poe-code/my-custom-worktree");
  });

  it("derives worktree name from plan file name when no name provided", async () => {
    const fs = createMemFs({
      "/.agents/poe-code-ralph/PROMPT_build.md": "ID: {{STORY_ID}}\n{{STORY_BLOCK}}\n",
      "/.poe-code-ralph/errors.log": "",
      "/.agents/tasks/plan-feature-x.yml": planYaml
    });
    const { deps: worktreeDeps, execCalls } = createWorktreeDeps(fs);
    const runId = "test-run-derive";

    const spawn = vi.fn(async () => ({
      stdout: "<promise>COMPLETE</promise>",
      stderr: "",
      exitCode: 0
    }));

    const result = await buildLoop({
      planPath: ".agents/tasks/plan-feature-x.yml",
      maxIterations: 3,
      commit: false,
      agent: "codex",
      staleSeconds: 0,
      cwd: "/",
      worktree: { enabled: true },
      deps: {
        fs,
        lock: noLock,
        runId,
        spawn,
        stdout: { write: () => {} },
        stderr: { write: () => {} },
        worktree: worktreeDeps,
        git: {
          getHead: () => null,
          getCommitList: () => [],
          getChangedFiles: () => [],
          getDirtyFiles: () => [],
          getCurrentBranch: () => "develop"
        },
        now: () => new Date("2026-02-02T06:00:00.000Z")
      }
    });

    // Name derived from plan file: "plan-feature-x" (without .yml)
    expect(result.worktreeBranch).toBe("poe-code/plan-feature-x");

    // Base branch was "develop"
    const createCmd = execCalls.find((c) => c.command.includes("git worktree add"));
    expect(createCmd?.command).toContain("develop");
  });

  it("resets all story statuses to open when copying plan to worktree", async () => {
    const donePlanYaml = stringify({
      version: 1,
      project: "Test",
      goals: [],
      nonGoals: [],
      qualityGates: ["npm run test"],
      stories: [
        {
          id: "US-001",
          title: "First story",
          status: "done",
          dependsOn: [],
          description: "Already done story.",
          acceptanceCriteria: ["Criterion A"],
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T01:00:00.000Z",
          updatedAt: "2026-01-01T01:00:00.000Z"
        },
        {
          id: "US-002",
          title: "Second story",
          status: "done",
          dependsOn: ["US-001"],
          description: "Also done.",
          acceptanceCriteria: ["Criterion B"],
          startedAt: "2026-01-02T00:00:00.000Z",
          completedAt: "2026-01-02T01:00:00.000Z",
          updatedAt: "2026-01-02T01:00:00.000Z"
        }
      ]
    });

    const fs = createMemFs({
      "/.agents/poe-code-ralph/PROMPT_build.md": PROMPT_TEMPLATE,
      "/.poe-code-ralph/errors.log": "",
      "/.agents/tasks/plan-done.yaml": donePlanYaml
    });
    const { deps: worktreeDeps } = createWorktreeDeps(fs);
    const runId = "test-run-reset";

    const spawnCalls: string[] = [];
    const spawn = vi.fn(async (_agent: string, options: { prompt: string; cwd?: string }) => {
      spawnCalls.push(options.cwd ?? "");
      return {
        stdout: "<promise>COMPLETE</promise>",
        stderr: "",
        exitCode: 0
      };
    });

    const result = await buildLoop({
      planPath: ".agents/tasks/plan-done.yaml",
      maxIterations: 5,
      commit: false,
      agent: "codex",
      staleSeconds: 0,
      cwd: "/",
      worktree: { enabled: true },
      deps: {
        fs,
        lock: noLock,
        runId,
        spawn,
        stdout: { write: () => {} },
        stderr: { write: () => {} },
        worktree: worktreeDeps,
        git: {
          getHead: () => null,
          getCommitList: () => [],
          getChangedFiles: () => [],
          getDirtyFiles: () => [],
          getCurrentBranch: () => "main"
        },
        now: () => new Date("2026-02-02T06:00:00.000Z")
      }
    });

    // Both stories should have been processed (not skipped as already done)
    expect(result.storiesDone).toEqual(["US-001", "US-002"]);
    expect(spawn).toHaveBeenCalledTimes(2);

    // Verify the worktree plan was reset before the loop started
    const worktreePlanPath =
      "/.poe-code-ralph/worktrees/plan-done/.agents/tasks/plan-done.yaml";
    const finalPlan = parsePlan(await fs.readFile(worktreePlanPath, "utf8"));
    // After successful run, stories should be done again
    expect(finalPlan.stories[0]?.status).toBe("done");
    expect(finalPlan.stories[1]?.status).toBe("done");
  });

  it("resumes a failed worktree run instead of starting fresh", async () => {
    // Plan with US-001 done and US-002 open (simulating a partial run)
    const partialPlanYaml = stringify({
      version: 1,
      project: "Test",
      goals: [],
      nonGoals: [],
      qualityGates: ["npm run test"],
      stories: [
        {
          id: "US-001",
          title: "First story",
          status: "done",
          dependsOn: [],
          description: "Already completed.",
          acceptanceCriteria: ["Criterion A"],
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T01:00:00.000Z",
          updatedAt: "2026-01-01T01:00:00.000Z"
        },
        {
          id: "US-002",
          title: "Second story",
          status: "open",
          dependsOn: ["US-001"],
          description: "Still needs work.",
          acceptanceCriteria: ["Criterion B"]
        }
      ]
    });

    // Set up: original cwd has the plan (all done in original), worktree has partial plan
    const originalPlanYaml = stringify({
      version: 1,
      project: "Test",
      goals: [],
      nonGoals: [],
      qualityGates: ["npm run test"],
      stories: [
        {
          id: "US-001",
          title: "First story",
          status: "done",
          dependsOn: [],
          description: "Already completed.",
          acceptanceCriteria: ["Criterion A"]
        },
        {
          id: "US-002",
          title: "Second story",
          status: "done",
          dependsOn: ["US-001"],
          description: "Still needs work.",
          acceptanceCriteria: ["Criterion B"]
        }
      ]
    });

    const fs = createMemFs({
      // Original cwd files
      "/.agents/poe-code-ralph/PROMPT_build.md": PROMPT_TEMPLATE,
      "/.poe-code-ralph/errors.log": "",
      "/.agents/tasks/plan-resume.yaml": originalPlanYaml,
      // Existing worktree files (from previous failed run)
      "/.poe-code-ralph/worktrees/plan-resume/.agents/tasks/plan-resume.yaml": partialPlanYaml,
      // Registry showing a failed worktree
      "/.poe-code-ralph/worktrees.yaml": stringify({
        worktrees: [
          {
            name: "plan-resume",
            path: "/.poe-code-ralph/worktrees/plan-resume",
            branch: "poe-code/plan-resume",
            baseBranch: "main",
            createdAt: "2026-02-01T00:00:00.000Z",
            source: "ralph-build",
            agent: "codex",
            status: "failed",
            planPath: ".agents/tasks/plan-resume.yaml"
          }
        ]
      })
    });

    // The worktree already has symlinks from previous run - simulate them
    await fs.mkdir("/.poe-code-ralph/worktrees/plan-resume/.poe-code-ralph", { recursive: true });
    await fs.symlink(
      "/.agents/poe-code-ralph",
      "/.poe-code-ralph/worktrees/plan-resume/.agents/poe-code-ralph"
    );

    const { deps: worktreeDeps, execCalls } = createWorktreeDeps(fs);
    const runId = "test-run-resume";

    const spawn = vi.fn(async () => ({
      stdout: "<promise>COMPLETE</promise>",
      stderr: "",
      exitCode: 0
    }));

    const result = await buildLoop({
      planPath: ".agents/tasks/plan-resume.yaml",
      maxIterations: 5,
      commit: false,
      agent: "codex",
      staleSeconds: 0,
      cwd: "/",
      worktree: { enabled: true },
      deps: {
        fs,
        lock: noLock,
        runId,
        spawn,
        stdout: { write: () => {} },
        stderr: { write: () => {} },
        worktree: worktreeDeps,
        git: {
          getHead: () => null,
          getCommitList: () => [],
          getChangedFiles: () => [],
          getDirtyFiles: () => [],
          getCurrentBranch: () => "main"
        },
        now: () => new Date("2026-02-02T06:00:00.000Z")
      }
    });

    // Should NOT have called git worktree add (no fresh creation)
    const createCmd = execCalls.find((c) => c.command.includes("git worktree add"));
    expect(createCmd).toBeUndefined();

    // Only US-002 should have been processed (US-001 was already done)
    expect(result.storiesDone).toEqual(["US-002"]);
    expect(spawn).toHaveBeenCalledTimes(1);

    // Worktree branch is still set
    expect(result.worktreeBranch).toBe("poe-code/plan-resume");
  });

  it("starts fresh when previous worktree has status done", async () => {
    const allDonePlanYaml = stringify({
      version: 1,
      project: "Test",
      goals: [],
      nonGoals: [],
      qualityGates: ["npm run test"],
      stories: [
        {
          id: "US-001",
          title: "Do the thing",
          status: "done",
          dependsOn: [],
          description: "As a user, I want a thing.",
          acceptanceCriteria: ["Criterion A"]
        }
      ]
    });

    const fs = createMemFs({
      "/.agents/poe-code-ralph/PROMPT_build.md": PROMPT_TEMPLATE,
      "/.poe-code-ralph/errors.log": "",
      "/.agents/tasks/plan-build-worktree.yaml": allDonePlanYaml,
      // Registry showing a completed worktree
      "/.poe-code-ralph/worktrees.yaml": stringify({
        worktrees: [
          {
            name: "plan-build-worktree",
            path: "/.poe-code-ralph/worktrees/plan-build-worktree",
            branch: "poe-code/plan-build-worktree",
            baseBranch: "main",
            createdAt: "2026-02-01T00:00:00.000Z",
            source: "ralph-build",
            agent: "codex",
            status: "done"
          }
        ]
      })
    });
    const { deps: worktreeDeps, execCalls } = createWorktreeDeps(fs);
    const runId = "test-run-fresh-after-done";

    const spawn = vi.fn(async () => ({
      stdout: "<promise>COMPLETE</promise>",
      stderr: "",
      exitCode: 0
    }));

    const result = await buildLoop({
      planPath: ".agents/tasks/plan-build-worktree.yaml",
      maxIterations: 3,
      commit: false,
      agent: "codex",
      staleSeconds: 0,
      cwd: "/",
      worktree: { enabled: true },
      deps: {
        fs,
        lock: noLock,
        runId,
        spawn,
        stdout: { write: () => {} },
        stderr: { write: () => {} },
        worktree: worktreeDeps,
        git: {
          getHead: () => null,
          getCommitList: () => [],
          getChangedFiles: () => [],
          getDirtyFiles: () => [],
          getCurrentBranch: () => "main"
        },
        now: () => new Date("2026-02-02T06:00:00.000Z")
      }
    });

    // SHOULD have created a fresh worktree (status was done → start over)
    const createCmd = execCalls.find((c) => c.command.includes("git worktree add"));
    expect(createCmd).toBeDefined();

    // Story should have been reset and re-done
    expect(result.storiesDone).toEqual(["US-001"]);
  });

  it("does not create worktree when worktree option is not set", async () => {
    const fs = createMemFs({
      "/.agents/poe-code-ralph/PROMPT_build.md": "ID: {{STORY_ID}}\n{{STORY_BLOCK}}\n",
      "/.poe-code-ralph/errors.log": "",
      "/.agents/tasks/plan.yaml": planYaml
    });
    const runId = "test-run-no-wt";

    let capturedCwd = "";
    const spawn = vi.fn(async (_agent: string, options: { prompt: string; cwd?: string }) => {
      capturedCwd = options.cwd ?? "";
      return {
        stdout: "<promise>COMPLETE</promise>",
        stderr: "",
        exitCode: 0
      };
    });

    const result = await buildLoop({
      planPath: ".agents/tasks/plan.yaml",
      maxIterations: 3,
      commit: false,
      agent: "codex",
      staleSeconds: 0,
      cwd: "/",
      deps: {
        fs,
        lock: noLock,
        runId,
        spawn,
        stderr: { write: () => {} },
        git: {
          getHead: () => null,
          getCommitList: () => [],
          getChangedFiles: () => [],
          getDirtyFiles: () => []
        },
        now: () => new Date("2026-02-02T06:00:00.000Z")
      }
    });

    // Build ran in cwd, not a worktree
    expect(capturedCwd).toBe("/");
    expect(result.worktreeBranch).toBeUndefined();
    expect(result.storiesDone).toEqual(["US-001"]);
  });
});
