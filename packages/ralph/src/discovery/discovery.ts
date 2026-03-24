import path from "node:path";
import * as fsPromises from "node:fs/promises";
import type { RalphFileStat } from "../types.js";

type DiscoveryFs = {
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<RalphFileStat>;
};

function createDefaultFs(): DiscoveryFs {
  return {
    readdir: fsPromises.readdir,
    stat: async (filePath) => {
      const stat = await fsPromises.stat(filePath);
      return {
        isFile: () => stat.isFile(),
        mtimeMs: stat.mtimeMs
      };
    }
  };
}

function isNotFound(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function isMarkdownFile(entry: string): boolean {
  return entry.toLowerCase().endsWith(".md");
}

async function scanDir(
  fs: DiscoveryFs,
  absoluteDir: string,
  displayDir: string
): Promise<Array<{ path: string; displayPath: string }>> {
  let entries: string[];
  try {
    entries = await fs.readdir(absoluteDir);
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }

  const docs: Array<{ path: string; displayPath: string }> = [];

  for (const entry of entries) {
    if (!isMarkdownFile(entry)) {
      continue;
    }

    const absolutePath = path.join(absoluteDir, entry);
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      continue;
    }

    const displayPath = path.join(displayDir, entry);
    docs.push({
      path: displayPath,
      displayPath
    });
  }

  return docs;
}

export async function discoverDocs(options: {
  cwd: string;
  homeDir: string;
  fs?: DiscoveryFs;
}): Promise<Array<{ path: string; displayPath: string }>> {
  const fs = options.fs ?? createDefaultFs();
  const [localDocs, globalDocs] = await Promise.all([
    scanDir(
      fs,
      path.join(options.cwd, ".poe-code", "ralph", "plans"),
      ".poe-code/ralph/plans"
    ),
    scanDir(
      fs,
      path.join(options.homeDir, ".poe-code", "ralph", "plans"),
      "~/.poe-code/ralph/plans"
    )
  ]);

  return [...localDocs, ...globalDocs].sort((left, right) => {
    const leftName = path.basename(left.displayPath).toLowerCase();
    const rightName = path.basename(right.displayPath).toLowerCase();
    return leftName === rightName
      ? left.displayPath.localeCompare(right.displayPath)
      : leftName.localeCompare(rightName);
  });
}
