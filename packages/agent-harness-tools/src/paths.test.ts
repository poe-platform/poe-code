import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { discoverWorkflowDocs, resolveWorkflowPath, type DiscoverDocsOptions } from "./paths.js";

const cwd = "/repo";
const homeDir = "/home/test";

type TestFs = DiscoverDocsOptions["fs"];

function createFs(files: Record<string, string>, directories: string[] = []): TestFs {
  const volume = Volume.fromJSON(files, "/");

  volume.mkdirSync(cwd, { recursive: true });
  volume.mkdirSync(homeDir, { recursive: true });

  for (const directory of directories) {
    volume.mkdirSync(directory, { recursive: true });
  }

  return createFsFromVolume(volume).promises as unknown as TestFs;
}

describe("resolveWorkflowPath", () => {
  it("returns absolute paths as-is", () => {
    expect(resolveWorkflowPath("/tmp/workflow.md", cwd, homeDir)).toBe("/tmp/workflow.md");
  });

  it("expands a bare tilde to the home directory", () => {
    expect(resolveWorkflowPath("~", cwd, homeDir)).toBe("/home/test");
  });

  it("resolves relative paths against cwd", () => {
    expect(resolveWorkflowPath("docs/workflow.md", cwd, homeDir)).toBe("/repo/docs/workflow.md");
  });

  it("expands tilde paths to the home directory", () => {
    expect(resolveWorkflowPath("~/.poe-code/experiments/test.md", cwd, homeDir)).toBe(
      "/home/test/.poe-code/experiments/test.md"
    );
  });
});

describe("discoverWorkflowDocs", () => {
  it("finds docs in the project directory", async () => {
    const docs = await discoverWorkflowDocs({
      cwd,
      homeDir,
      subDirectory: "experiments",
      fs: createFs({
        "/repo/.poe-code/experiments/alpha.md": "# alpha"
      })
    });

    expect(docs).toEqual(["/repo/.poe-code/experiments/alpha.md"]);
  });

  it("finds docs in the home directory", async () => {
    const docs = await discoverWorkflowDocs({
      cwd,
      homeDir,
      subDirectory: "experiments",
      fs: createFs({
        "/home/test/.poe-code/experiments/global.md": "# global"
      })
    });

    expect(docs).toEqual(["/home/test/.poe-code/experiments/global.md"]);
  });

  it("lets project docs shadow home docs with the same filename", async () => {
    const docs = await discoverWorkflowDocs({
      cwd,
      homeDir,
      subDirectory: "experiments",
      fs: createFs({
        "/repo/.poe-code/experiments/shared.md": "# project",
        "/home/test/.poe-code/experiments/shared.md": "# home",
        "/home/test/.poe-code/experiments/other.md": "# other"
      })
    });

    expect(docs).toEqual([
      "/home/test/.poe-code/experiments/other.md",
      "/repo/.poe-code/experiments/shared.md"
    ]);
  });

  it("returns sorted results", async () => {
    const docs = await discoverWorkflowDocs({
      cwd,
      homeDir,
      subDirectory: "pipeline/plans",
      glob: "*.yaml",
      fs: createFs({
        "/repo/.poe-code/pipeline/plans/plan-b.yaml": "tasks: []\n",
        "/repo/.poe-code/pipeline/plans/plan-a.yaml": "tasks: []\n",
        "/home/test/.poe-code/pipeline/plans/plan-c.yaml": "tasks: []\n"
      })
    });

    expect(docs).toEqual([
      "/home/test/.poe-code/pipeline/plans/plan-c.yaml",
      "/repo/.poe-code/pipeline/plans/plan-a.yaml",
      "/repo/.poe-code/pipeline/plans/plan-b.yaml"
    ]);
  });

  it("uses the default workflow glob for pipeline docs", async () => {
    const docs = await discoverWorkflowDocs({
      cwd,
      homeDir,
      subDirectory: "pipeline/plans",
      fs: createFs({
        "/repo/.poe-code/pipeline/plans/plan-a.yaml": "tasks: []\n",
        "/repo/.poe-code/pipeline/plans/notes.md": "# ignore"
      })
    });

    expect(docs).toEqual(["/repo/.poe-code/pipeline/plans/plan-a.yaml"]);
  });

  it("returns empty arrays for empty directories", async () => {
    const docs = await discoverWorkflowDocs({
      cwd,
      homeDir,
      subDirectory: "experiments",
      fs: createFs({}, [
        "/repo/.poe-code/experiments",
        "/home/test/.poe-code/experiments"
      ])
    });

    expect(docs).toEqual([]);
  });

  it("returns empty arrays for missing directories", async () => {
    await expect(
      discoverWorkflowDocs({
        cwd,
        homeDir,
        subDirectory: "experiments",
        fs: createFs({})
      })
    ).resolves.toEqual([]);
  });

  it("returns empty arrays when a workflow path points to a file instead of a directory", async () => {
    const docs = await discoverWorkflowDocs({
      cwd,
      homeDir,
      subDirectory: "experiments",
      fs: createFs({
        "/repo/.poe-code/experiments": "not a directory"
      })
    });

    expect(docs).toEqual([]);
  });

  it("rejects subdirectories that escape the workflow state roots", async () => {
    await expect(
      discoverWorkflowDocs({
        cwd: "/repo/project",
        homeDir: "/home/test/user",
        subDirectory: "../../secrets",
        fs: createFs({
          "/repo/secrets/outside.md": "# outside",
          "/home/test/secrets/global.md": "# global"
        })
      })
    ).rejects.toThrow("Workflow subdirectory must remain within the state root");
  });
});
