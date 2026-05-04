import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { discoverExperimentDocs } from "./discovery/discovery.js";
import { runExperimentLoop } from "./run/loop.js";
import type { ExecFn, ExperimentFileSystem, ExperimentGit } from "./types.js";

const cwd = "/repo";
const homeDir = "/home/test";

function createFs(files: Record<string, string> = {}): ExperimentFileSystem {
  const volume = Volume.fromJSON(files, "/");
  volume.mkdirSync(cwd, { recursive: true });
  volume.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as ExperimentFileSystem;
}

function createDoc(): string {
  return [
    "---",
    "agent: claude-code",
    "metric:",
    "  name: tests",
    "  script: node scripts/metric-tests.mjs",
    "  direction: maximize",
    "baseline: { tests: 1 }",
    "---",
    "# Improve tests"
  ].join("\n");
}

function createExperimentPlanDoc(content: string): string {
  return ["---", "kind: experiment", "---", "", content].join("\n");
}

function createGit(): ExperimentGit {
  return {
    reset: vi.fn(async () => undefined),
    currentHash: vi.fn(async () => "base-1")
  };
}

function createExec(): ExecFn {
  return vi.fn(async () => {
    throw new Error("Unexpected exec call");
  }) as ExecFn;
}

describe("experiment-loop agent-kit discovery", () => {
  it("discovers default experiment docs from the project directory", async () => {
    const docs = await discoverExperimentDocs({
      cwd,
      homeDir,
      fs: createFs({
        "/repo/.poe-code/experiments/shared.md": createExperimentPlanDoc("# project"),
        "/home/test/.poe-code/experiments/global.md": createExperimentPlanDoc("# global"),
        "/home/test/.poe-code/experiments/shared.md": createExperimentPlanDoc("# home")
      })
    });

    expect(docs).toEqual([
      {
        path: ".poe-code/experiments/shared.md",
        displayPath: ".poe-code/experiments/shared.md"
      }
    ]);
  });

  it("discovers docs from a custom experiment directory", async () => {
    const docs = await discoverExperimentDocs({
      cwd,
      homeDir,
      planDirectory: "docs/experiments",
      fs: createFs({
        "/repo/docs/experiments/plan-b.md": createExperimentPlanDoc("# B"),
        "/repo/docs/experiments/plan-a.md": createExperimentPlanDoc("# A")
      })
    });

    expect(docs).toEqual([
      {
        path: "docs/experiments/plan-a.md",
        displayPath: "docs/experiments/plan-a.md"
      },
      {
        path: "docs/experiments/plan-b.md",
        displayPath: "docs/experiments/plan-b.md"
      }
    ]);
  });
});

describe("experiment-loop agent-kit locking", () => {
  it("locks the doc before initializing the journal and releases the lock after the run", async () => {
    const docPath = "/repo/.poe-code/experiments/plan.md";
    const journalPath = "/repo/.poe-code/experiments/plan.journal.jsonl";
    const lockPath = `${docPath}.lock`;
    const baseFs = createFs({
      [docPath]: createDoc()
    });
    const operations: string[] = [];
    const fs: ExperimentFileSystem = {
      readFile: async (filePath, encoding) => {
        operations.push(`readFile:${filePath}`);
        return baseFs.readFile(filePath, encoding);
      },
      writeFile: async (filePath, content) => {
        operations.push(`writeFile:${filePath}`);
        await baseFs.writeFile(filePath, content);
      },
      readdir: async (filePath) => baseFs.readdir(filePath),
      stat: async (filePath) => baseFs.stat(filePath),
      mkdir: async (filePath, options) => baseFs.mkdir(filePath, options),
      rmdir: async (filePath) => baseFs.rmdir(filePath),
      open: async (filePath, flags) => {
        operations.push(`open:${filePath}`);
        return baseFs.open(filePath, flags);
      },
      unlink: async (filePath) => {
        operations.push(`unlink:${filePath}`);
        await baseFs.unlink(filePath);
      },
      appendFile: async (filePath, content) => {
        operations.push(`appendFile:${filePath}`);
        await baseFs.appendFile(filePath, content);
      }
    } as ExperimentFileSystem;

    await runExperimentLoop({
      cwd,
      homeDir,
      docPath,
      maxExperiments: 0,
      fs,
      git: createGit(),
      exec: createExec(),
      runAgent: vi.fn()
    });

    expect(operations.indexOf(`open:${lockPath}`)).toBeGreaterThanOrEqual(0);
    expect(operations.indexOf(`open:${lockPath}`)).toBeLessThan(
      operations.indexOf(`writeFile:${journalPath}`)
    );
    expect(operations.at(-1)).toBe(`unlink:${lockPath}`);
    await expect(fs.stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("releases the lock when the experiment run fails", async () => {
    const docPath = "/repo/.poe-code/experiments/plan.md";
    const fs = createFs({
      [docPath]: createDoc()
    });

    await expect(
      runExperimentLoop({
        cwd,
        homeDir,
        docPath,
        maxExperiments: 1,
        fs,
        git: createGit(),
        exec: createExec(),
        runAgent: vi.fn(async () => {
          throw new Error("agent failed");
        })
      })
    ).rejects.toThrow("agent failed");

    await expect(fs.stat(`${docPath}.lock`)).rejects.toMatchObject({
      code: "ENOENT"
    });
  });
});
