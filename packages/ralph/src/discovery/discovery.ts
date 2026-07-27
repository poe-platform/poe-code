import * as fsPromises from "node:fs/promises";
import { discoverPlans } from "@poe-code/agent-harness-tools";
import type { RalphFileStat } from "../types.js";

type DiscoveryFs = {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  readdir(path: string): Promise<string[]>;
  lstat(path: string): Promise<{ isSymbolicLink(): boolean }>;
  stat(path: string): Promise<RalphFileStat>;
};

type SharedDiscoverPlansFs = NonNullable<Parameters<typeof discoverPlans>[0]["fs"]>;

function createDefaultFs(): DiscoveryFs {
  return {
    readFile: fsPromises.readFile as DiscoveryFs["readFile"],
    readdir: fsPromises.readdir,
    lstat: async (filePath) => {
      const stat = await fsPromises.lstat(filePath);
      return { isSymbolicLink: () => stat.isSymbolicLink() };
    },
    stat: async (filePath) => {
      const stat = await fsPromises.stat(filePath);
      return {
        isFile: () => stat.isFile(),
        isDirectory: () => stat.isDirectory(),
        mtimeMs: stat.mtimeMs
      };
    }
  };
}

export async function discoverDocs(options: {
  cwd: string;
  homeDir: string;
  planDirectory?: string;
  fs?: DiscoveryFs;
}): Promise<Array<{ path: string; displayPath: string }>> {
  const fs = options.fs ?? createDefaultFs();
  const plans = await discoverPlans({
    cwd: options.cwd,
    homeDir: options.homeDir,
    planDirectory: options.planDirectory?.trim() || ".poe-code/ralph/plans",
    kinds: ["ralph"],
    fs: fs as unknown as SharedDiscoverPlansFs
  });

  return plans.map((plan) => ({
    path: plan.displayPath,
    displayPath: `${plan.displayPath}${plan.readiness === "ready" ? " ✓" : ""}`
  }));
}
