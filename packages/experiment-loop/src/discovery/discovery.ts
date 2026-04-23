import path from "node:path";
import * as fsPromises from "node:fs/promises";
import {
  discoverWorkflowDocs,
  resolveWorkflowPath
} from "@poe-code/agent-harness-tools";

type DiscoveryFileStat = {
  isFile(): boolean;
};

export type ExperimentDiscoveryFs = {
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<DiscoveryFileStat>;
};

export interface DiscoverExperimentDocsOptions {
  cwd: string;
  homeDir: string;
  planDirectory?: string;
  fs?: ExperimentDiscoveryFs;
}

function createDefaultFs(): ExperimentDiscoveryFs {
  return {
    readdir: fsPromises.readdir,
    stat: async (filePath) => {
      const stat = await fsPromises.stat(filePath);
      return {
        isFile: () => stat.isFile()
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
  fs: ExperimentDiscoveryFs,
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

function toDisplayPath(options: {
  absolutePath: string;
  cwd: string;
  homeDir: string;
}): string {
  const localDir = path.join(options.cwd, ".poe-code", "experiments");
  const globalDir = path.join(options.homeDir, ".poe-code", "experiments");

  if (options.absolutePath.startsWith(`${localDir}${path.sep}`)) {
    return path.join(
      ".poe-code/experiments",
      path.relative(localDir, options.absolutePath)
    );
  }

  if (options.absolutePath.startsWith(`${globalDir}${path.sep}`)) {
    return path.join(
      "~/.poe-code/experiments",
      path.relative(globalDir, options.absolutePath)
    );
  }

  return options.absolutePath;
}

async function scanCustomDir(
  fs: ExperimentDiscoveryFs,
  planDirectory: string,
  cwd: string,
  homeDir: string
): Promise<Array<{ path: string; displayPath: string }>> {
  const absoluteDir = resolveWorkflowPath(planDirectory, cwd, homeDir);
  return scanDir(fs, absoluteDir, planDirectory);
}

async function scanDefaultDirs(
  fs: ExperimentDiscoveryFs,
  cwd: string,
  homeDir: string
): Promise<Array<{ path: string; displayPath: string }>> {
  const docs = await discoverWorkflowDocs({
    cwd,
    homeDir,
    subDirectory: "experiments",
    fs
  });

  return docs.map((absolutePath) => {
    const displayPath = toDisplayPath({
      absolutePath,
      cwd,
      homeDir
    });

    return {
      path: displayPath,
      displayPath
    };
  });
}

export async function discoverExperimentDocs(
  options: DiscoverExperimentDocsOptions
): Promise<Array<{ path: string; displayPath: string }>> {
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
