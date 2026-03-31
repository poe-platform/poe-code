import { describe, expect, it } from "bun:test";
import { Volume, createFsFromVolume } from "memfs";
import { discoverDocs } from "./discovery.js";
function createFs(files: Record<string, string>) {
  const volume = Volume.fromJSON(files, "/");
  const rawFs = createFsFromVolume(volume).promises;

  return {
    readdir: (filePath: string) =>
      rawFs.readdir(filePath) as Promise<string[]>,
    stat: async (filePath: string) => {
      const stat = await rawFs.stat(filePath);
      return {
        isFile: () => stat.isFile(),
        mtimeMs: Number(stat.mtimeMs)
      };
    }
  };
}

describe("discoverDocs", () => {
  it("finds local and global markdown docs and sorts them by file name", async () => {
    const fs = createFs({
      "/repo/.poe-code/ralph/plans/zeta.md": "# zeta",
      "/repo/.poe-code/ralph/plans/notes.txt": "ignore",
      "/repo/.poe-code/ralph/plans/alpha.md": "# alpha",
      "/home/test/.poe-code/ralph/plans/beta.md": "# beta"
    });

    await expect(
      discoverDocs({
        cwd: "/repo",
        homeDir: "/home/test",
        fs
      })
    ).resolves.toEqual([
      {
        path: ".poe-code/ralph/plans/alpha.md",
        displayPath: ".poe-code/ralph/plans/alpha.md"
      },
      {
        path: "~/.poe-code/ralph/plans/beta.md",
        displayPath: "~/.poe-code/ralph/plans/beta.md"
      },
      {
        path: ".poe-code/ralph/plans/zeta.md",
        displayPath: ".poe-code/ralph/plans/zeta.md"
      }
    ]);
  });

  it("ignores missing plans directories", async () => {
    const fs = createFs({});

    await expect(
      discoverDocs({
        cwd: "/repo",
        homeDir: "/home/test",
        fs
      })
    ).resolves.toEqual([]);
  });

  it("scans only the custom planDirectory when provided", async () => {
    const fs = createFs({
      "/repo/custom-plans/alpha.md": "# alpha",
      "/repo/.poe-code/ralph/plans/default.md": "# default"
    });

    const result = await discoverDocs({
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: "custom-plans",
      fs
    });

    expect(result).toEqual([
      { path: "custom-plans/alpha.md", displayPath: "custom-plans/alpha.md" }
    ]);
  });

  it("resolves absolute planDirectory paths", async () => {
    const fs = createFs({
      "/abs/plans/doc.md": "# doc"
    });

    const result = await discoverDocs({
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: "/abs/plans",
      fs
    });

    expect(result).toEqual([
      { path: "/abs/plans/doc.md", displayPath: "/abs/plans/doc.md" }
    ]);
  });

  it("resolves tilde planDirectory paths", async () => {
    const fs = createFs({
      "/home/test/my-plans/doc.md": "# doc"
    });

    const result = await discoverDocs({
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: "~/my-plans",
      fs
    });

    expect(result).toEqual([
      { path: "~/my-plans/doc.md", displayPath: "~/my-plans/doc.md" }
    ]);
  });

  it("returns empty when custom planDirectory does not exist", async () => {
    const fs = createFs({});

    const result = await discoverDocs({
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: "nonexistent",
      fs
    });

    expect(result).toEqual([]);
  });
});
