import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { discoverDocs } from "./discovery.js";
import type { RalphFileSystem } from "../types.js";

function createFs(files: Record<string, string>): RalphFileSystem {
  const volume = Volume.fromJSON(files, "/");
  const rawFs = createFsFromVolume(volume).promises;

  return {
    readFile: (filePath, encoding) =>
      rawFs.readFile(filePath, encoding) as Promise<string>,
    readdir: (filePath) => rawFs.readdir(filePath) as Promise<string[]>,
    stat: async (filePath) => {
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
});
