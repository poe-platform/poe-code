import * as fsPromises from "node:fs/promises";
import {
  discoverPlans,
  type DiscoverPlansOptions
} from "@poe-code/agent-harness-tools";
import type { RalphFileSystem } from "../types.js";

type DiscoveryFs = NonNullable<DiscoverPlansOptions["fs"]>;

function createDefaultFs(): DiscoveryFs {
  return {
    readFile: fsPromises.readFile as RalphFileSystem["readFile"],
    writeFile: (filePath: string, content: string) =>
      fsPromises.writeFile(filePath, content, "utf8"),
    readdir: fsPromises.readdir,
    open: (filePath: string, flags: string) => fsPromises.open(filePath, flags),
    stat: async (filePath) => {
      const stat = await fsPromises.stat(filePath);
      return {
        isFile: () => stat.isFile(),
        isDirectory: () => stat.isDirectory(),
        mtimeMs: stat.mtimeMs
      };
    },
    unlink: async (filePath: string) => {
      await fsPromises.unlink(filePath);
    },
    mkdir: async (filePath: string, options?: { recursive?: boolean }) => {
      await fsPromises.mkdir(filePath, options);
    },
    rename: async (oldPath: string, newPath: string) => {
      await fsPromises.rename(oldPath, newPath);
    }
  } as DiscoveryFs;
}

export async function discoverDocs(options: {
  cwd: string;
  homeDir: string;
  planDirectory?: string;
  fs?: DiscoveryFs;
}): Promise<Array<{ path: string; displayPath: string }>> {
  const fs = options.fs ?? createDefaultFs();
  const docs = await discoverPlans({
    cwd: options.cwd,
    homeDir: options.homeDir,
    planDirectory: options.planDirectory?.trim() || ".poe-code/ralph/plans",
    kinds: ["ralph"],
    fs
  });

  return docs.map((doc) => ({
    path: doc.displayPath,
    displayPath: doc.displayPath
  }));
}
