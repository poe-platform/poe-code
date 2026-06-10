import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import path from "node:path";
import { hasOwnErrorCode } from "./error-codes.js";

export type GitDirRunner = (cwd: string) => string | undefined;

const defaultMarkerPrefix = "poe-code-spawn-skills";

function defaultGitDirRunner(cwd: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--git-dir"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return undefined;
  }
}

let gitDirRunner: GitDirRunner = defaultGitDirRunner;

export function setGitDirRunnerForTest(runner: GitDirRunner): () => void {
  const previous = gitDirRunner;
  gitDirRunner = runner;
  return () => {
    gitDirRunner = previous;
  };
}

function resolveExcludePath(cwd: string): string | undefined {
  const gitDir = gitDirRunner(cwd);
  if (gitDir === undefined || gitDir.length === 0) {
    return undefined;
  }

  return path.join(path.isAbsolute(gitDir) ? gitDir : path.resolve(cwd, gitDir), "info/exclude");
}

function markers(runId: string, markerPrefix: string): { begin: string; end: string } {
  return {
    begin: `# ${markerPrefix}:${runId} begin`,
    end: `# ${markerPrefix}:${runId} end`
  };
}

function assertSingleLine(value: string, label: string): void {
  if (value.includes("\n") || value.includes("\r")) {
    throw new Error(`${label} must be a single line`);
  }
}

function readExcludeFile(excludePath: string): string | undefined {
  try {
    return fs.readFileSync(excludePath, "utf8");
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return hasOwnErrorCode(error, "EEXIST");
}

function assertNoSymbolicLink(targetPath: string): void {
  const parsed = path.parse(path.resolve(targetPath));
  let current = parsed.root;

  for (const segment of path.resolve(targetPath).slice(parsed.root.length).split(path.sep)) {
    if (segment.length === 0) {
      continue;
    }
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new Error(`Refusing to update Git exclude path through symbolic link: ${current}`);
      }
    } catch (error) {
      if (hasOwnErrorCode(error, "ENOENT")) {
        return;
      }
      throw error;
    }
  }
}

function writeExcludeFile(excludePath: string, content: string): void {
  assertNoSymbolicLink(excludePath);
  fs.mkdirSync(path.dirname(excludePath), { recursive: true });
  assertNoSymbolicLink(excludePath);
  const tempPath = `${excludePath}.poe-code-${process.pid}-${randomUUID()}.tmp`;
  let tempCreated = false;
  try {
    assertNoSymbolicLink(tempPath);
    fs.writeFileSync(tempPath, content, { encoding: "utf8", flag: "wx" });
    tempCreated = true;
    fs.renameSync(tempPath, excludePath);
  } catch (error) {
    if (tempCreated || !isAlreadyExistsError(error)) {
      try {
        fs.rmSync(tempPath, { force: true });
      } catch (cleanupError) {
        void cleanupError;
      }
    }
    throw error;
  }
}

function removeBlock(content: string, runId: string, markerPrefix: string): string {
  const { begin, end } = markers(runId, markerPrefix);
  const lines = content.split("\n");
  const result: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === begin) {
      const endIndex = lines.indexOf(end, index + 1);
      if (endIndex !== -1) {
        index = endIndex;
        continue;
      }
    }

    result.push(lines[index]);
  }

  return result.join("\n");
}

function appendBlock(
  content: string | undefined,
  runId: string,
  entries: string[],
  markerPrefix: string
): string {
  const { begin, end } = markers(runId, markerPrefix);
  const existing = content ?? "";
  const prefix = existing.length === 0 || existing.endsWith("\n") ? existing : `${existing}\n`;
  return `${prefix}${[begin, ...entries, end, ""].join("\n")}`;
}

function nextBlockId(content: string | undefined, runId: string, markerPrefix: string): string {
  if (content === undefined || !content.includes(markers(runId, markerPrefix).begin)) {
    return runId;
  }

  let suffix = 1;
  while (content.includes(markers(`${runId}:${suffix}`, markerPrefix).begin)) {
    suffix += 1;
  }
  return `${runId}:${suffix}`;
}

export function appendExcludeBlock(
  cwd: string,
  runId: string,
  entries: string[],
  opts?: { markerPrefix?: string }
): string | undefined {
  assertSingleLine(runId, "runId");
  assertSingleLine(opts?.markerPrefix ?? defaultMarkerPrefix, "markerPrefix");
  for (const entry of entries) {
    assertSingleLine(entry, "exclude entry");
  }
  const excludePath = resolveExcludePath(cwd);
  if (excludePath === undefined) {
    return undefined;
  }

  assertNoSymbolicLink(excludePath);
  const content = readExcludeFile(excludePath);
  const markerPrefix = opts?.markerPrefix ?? defaultMarkerPrefix;
  const blockId = nextBlockId(content, runId, markerPrefix);
  writeExcludeFile(excludePath, appendBlock(content, blockId, entries, markerPrefix));
  return blockId;
}

export function removeExcludeBlock(
  cwd: string,
  runId: string,
  opts?: { markerPrefix?: string }
): void {
  assertSingleLine(runId, "runId");
  assertSingleLine(opts?.markerPrefix ?? defaultMarkerPrefix, "markerPrefix");
  const excludePath = resolveExcludePath(cwd);
  if (excludePath === undefined) {
    return;
  }

  const content = readExcludeFile(excludePath);
  if (content === undefined) {
    return;
  }

  writeExcludeFile(excludePath, removeBlock(content, runId, opts?.markerPrefix ?? defaultMarkerPrefix));
}
