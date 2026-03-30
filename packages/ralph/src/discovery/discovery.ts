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
  planDirectory?: string;
  fs?: DiscoveryFs;
}): Promise<Array<{ path: string; displayPath: string }>> {
  const fs = options.fs ?? createDefaultFs();

  const customDir = options.planDirectory?.trim();
  const docs = customDir
    ? await scanCustomDir(fs, customDir, options.cwd, options.homeDir)
    : await scanDefaultDirs(fs, options.cwd, options.homeDir);

  return docs.sort((left, right) => {
    const leftName = path.basename(left.displayPath).toLowerCase();
    const rightName = path.basename(right.displayPath).toLowerCase();
    return leftName === rightName
      ? left.displayPath.localeCompare(right.displayPath)
      : leftName.localeCompare(rightName);
  });
}

async function scanCustomDir(
  fs: DiscoveryFs,
  planDirectory: string,
  cwd: string,
  homeDir: string
): Promise<Array<{ path: string; displayPath: string }>> {
  const absoluteDir = resolveAbsoluteDirectory(planDirectory, cwd, homeDir);
  const displayDir = planDirectory;
  return scanDir(fs, absoluteDir, displayDir);
}

async function scanDefaultDirs(
  fs: DiscoveryFs,
  cwd: string,
  homeDir: string
): Promise<Array<{ path: string; displayPath: string }>> {
  const [localDocs, globalDocs] = await Promise.all([
    scanDir(
      fs,
      path.join(cwd, ".poe-code", "ralph", "plans"),
      ".poe-code/ralph/plans"
    ),
    scanDir(
      fs,
      path.join(homeDir, ".poe-code", "ralph", "plans"),
      "~/.poe-code/ralph/plans"
    )
  ]);
  return [...localDocs, ...globalDocs];
}

function resolveAbsoluteDirectory(dir: string, cwd: string, homeDir: string): string {
  if (dir.startsWith("~/")) {
    return path.join(homeDir, dir.slice(2));
  }
  return path.isAbsolute(dir) ? dir : path.resolve(cwd, dir);
}
