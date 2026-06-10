import path from "node:path";
import { hasOwnErrorCode } from "./error-codes.js";
import { assertContainedPath } from "./path-boundary.js";

export function resolveWorkflowPath(inputPath: string, cwd: string, homeDir: string): string {
  if (inputPath.startsWith("~/")) {
    return path.join(homeDir, inputPath.slice(2));
  }

  if (inputPath === "~") {
    return homeDir;
  }

  return path.isAbsolute(inputPath) ? inputPath : path.resolve(cwd, inputPath);
}

export interface DiscoverDocsOptions {
  cwd: string;
  homeDir: string;
  subDirectory: string;
  glob?: string;
  fs: {
    lstat: (path: string) => Promise<{ isSymbolicLink(): boolean }>;
    readdir: (path: string) => Promise<string[]>;
  };
}

function isMissingDirectory(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT") || hasOwnErrorCode(error, "ENOTDIR");
}

function defaultGlobForSubDirectory(subDirectory: string): string {
  return subDirectory.startsWith("pipeline/") ? "*.yaml" : "*.md";
}

function matchesGlob(fileName: string, glob: string): boolean {
  if (glob === "*") {
    return true;
  }

  if (glob.startsWith("*.")) {
    const suffix = glob.slice(1).toLowerCase();
    return fileName.toLowerCase().endsWith(suffix);
  }

  return fileName === glob;
}

async function readDirectory(
  fs: DiscoverDocsOptions["fs"],
  directoryPath: string
): Promise<string[]> {
  try {
    if ((await fs.lstat(directoryPath)).isSymbolicLink()) {
      return [];
    }
    return await fs.readdir(directoryPath);
  } catch (error) {
    if (isMissingDirectory(error)) {
      return [];
    }

    throw error;
  }
}

async function discoverFromDirectory(options: {
  fs: DiscoverDocsOptions["fs"];
  directoryPath: string;
  glob: string;
}): Promise<Array<{ fileName: string; absolutePath: string }>> {
  const entries = await readDirectory(options.fs, options.directoryPath);

  return entries
    .filter((entry) => matchesGlob(entry, options.glob))
    .map((entry) => ({
      fileName: entry,
      absolutePath: path.join(options.directoryPath, entry)
    }));
}

export async function discoverWorkflowDocs(options: DiscoverDocsOptions): Promise<string[]> {
  const glob = options.glob ?? defaultGlobForSubDirectory(options.subDirectory);
  const projectRoot = path.join(options.cwd, ".poe-code");
  const globalRoot = path.join(options.homeDir, ".poe-code");
  const projectDirectory = path.join(projectRoot, options.subDirectory);
  const globalDirectory = path.join(globalRoot, options.subDirectory);

  assertContainedPath(
    projectRoot,
    projectDirectory,
    "Workflow subdirectory must remain within the state root"
  );
  assertContainedPath(
    globalRoot,
    globalDirectory,
    "Workflow subdirectory must remain within the state root"
  );

  const [projectDocs, globalDocs] = await Promise.all([
    discoverFromDirectory({
      fs: options.fs,
      directoryPath: projectDirectory,
      glob
    }),
    discoverFromDirectory({
      fs: options.fs,
      directoryPath: globalDirectory,
      glob
    })
  ]);

  const docsByFileName = new Map<string, string>();

  for (const doc of globalDocs) {
    docsByFileName.set(doc.fileName, doc.absolutePath);
  }

  for (const doc of projectDocs) {
    docsByFileName.set(doc.fileName, doc.absolutePath);
  }

  return [...docsByFileName.values()].sort((left, right) => left.localeCompare(right));
}
