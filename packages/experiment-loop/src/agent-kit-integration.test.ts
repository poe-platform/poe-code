import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { discoverExperimentDocs } from "./discovery/discovery.js";
import type { ExperimentFileSystem } from "./types.js";

const cwd = "/repo";
const homeDir = "/home/test";

function createFs(files: Record<string, string> = {}): ExperimentFileSystem {
  const volume = Volume.fromJSON(files, "/");
  volume.mkdirSync(cwd, { recursive: true });
  volume.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as ExperimentFileSystem;
}

function createDiscoveryDoc(title: string): string {
  return ["---", "kind: experiment", "---", "", `# ${title}`].join("\n");
}

describe("experiment-loop agent-kit discovery", () => {
  it("discovers default experiment docs from the project directory", async () => {
    const docs = await discoverExperimentDocs({
      cwd,
      homeDir,
      fs: createFs({
        "/repo/.poe-code/experiments/shared.md": createDiscoveryDoc("project"),
        "/home/test/.poe-code/experiments/global.md": createDiscoveryDoc("global"),
        "/home/test/.poe-code/experiments/shared.md": createDiscoveryDoc("home")
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
        "/repo/docs/experiments/plan-b.md": createDiscoveryDoc("B"),
        "/repo/docs/experiments/plan-a.md": createDiscoveryDoc("A")
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
