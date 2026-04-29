import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { discoverExperimentDocs } from "./discovery/discovery.js";
import type { ExperimentFileSystem } from "./types.js";

const { runHarnessMock } = vi.hoisted(() => ({
  runHarnessMock: vi.fn()
}));

vi.mock("@poe-code/agent-script", async () => {
  const actual = await vi.importActual<typeof import("@poe-code/agent-script")>(
    "@poe-code/agent-script"
  );

  return {
    ...actual,
    runHarness: runHarnessMock
  };
});

const { runExperimentLoop } = await import("./run/loop.js");

const cwd = "/repo";
const homeDir = "/home/test";

function createFs(files: Record<string, string> = {}): ExperimentFileSystem {
  const volume = Volume.fromJSON(files, "/");
  volume.mkdirSync(cwd, { recursive: true });
  volume.mkdirSync(homeDir, { recursive: true });
  volume.mkdirSync("/repo/.poe-code/experiments", { recursive: true });
  return createFsFromVolume(volume).promises as unknown as ExperimentFileSystem;
}

describe("experiment-loop agent-kit discovery", () => {
  it("discovers default experiment docs from project and home directories", async () => {
    const docs = await discoverExperimentDocs({
      cwd,
      homeDir,
      fs: createFs({
        "/repo/.poe-code/experiments/shared.md": "# project",
        "/home/test/.poe-code/experiments/global.md": "# global",
        "/home/test/.poe-code/experiments/shared.md": "# home"
      })
    });

    expect(docs).toEqual([
      {
        path: "~/.poe-code/experiments/global.md",
        displayPath: "~/.poe-code/experiments/global.md"
      },
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
        "/repo/docs/experiments/plan-b.md": "# B",
        "/repo/docs/experiments/plan-a.md": "# A"
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
  it("locks the doc before invoking the harness and releases the lock after the run", async () => {
    const docPath = "/repo/.poe-code/experiments/plan.md";
    const lockPath = `${docPath}.lock`;
    const baseFs = createFs({
      [docPath]: [
        "---",
        "kind: experiment",
        "version: 1",
        "agents:",
        "  experimenter:",
        "    agent: claude-code",
        "metric:",
        "  name: tests",
        "  direction: maximize",
        "---",
        "",
        "```js",
        "return {};",
        "```",
        ""
      ].join("\n")
    });
    const operations: string[] = [];
    const fs: ExperimentFileSystem = {
      readFile: async (filePath, encoding) => baseFs.readFile(filePath, encoding),
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

    runHarnessMock.mockResolvedValueOnce({
      ok: true,
      returnValue: {
        stopReason: "completed",
        experimentsCompleted: 0,
        experimentsKept: 0,
        totalDurationMs: 1
      }
    });

    await runExperimentLoop({
      cwd,
      homeDir,
      docPath,
      fs,
      runAgent: vi.fn()
    });

    expect(operations.indexOf(`open:${lockPath}`)).toBeGreaterThanOrEqual(0);
    expect(runHarnessMock).toHaveBeenCalledWith(docPath, expect.any(Object));
    expect(operations.at(-1)).toBe(`unlink:${lockPath}`);
    await expect(fs.stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("releases the lock when the harness run fails", async () => {
    const docPath = "/repo/.poe-code/experiments/plan.md";
    const fs = createFs({
      [docPath]: [
        "---",
        "kind: experiment",
        "version: 1",
        "agents:",
        "  experimenter:",
        "    agent: claude-code",
        "metric:",
        "  name: tests",
        "  direction: maximize",
        "---",
        "",
        "```js",
        "return {};",
        "```",
        ""
      ].join("\n")
    });

    runHarnessMock.mockRejectedValueOnce(new Error("harness failed"));

    await expect(
      runExperimentLoop({
        cwd,
        homeDir,
        docPath,
        fs,
        runAgent: vi.fn()
      })
    ).rejects.toThrow("harness failed");

    await expect(fs.stat(`${docPath}.lock`)).rejects.toMatchObject({
      code: "ENOENT"
    });
  });
});
