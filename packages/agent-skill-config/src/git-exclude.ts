import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";

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

function readExcludeFile(excludePath: string): string | undefined {
  try {
    return fs.readFileSync(excludePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
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

export function appendExcludeBlock(
  cwd: string,
  runId: string,
  entries: string[],
  markerPrefix = defaultMarkerPrefix
): void {
  const excludePath = resolveExcludePath(cwd);
  if (excludePath === undefined) {
    return;
  }

  fs.mkdirSync(path.dirname(excludePath), { recursive: true });
  const content = readExcludeFile(excludePath);
  fs.writeFileSync(excludePath, appendBlock(content, runId, entries, markerPrefix), "utf8");
}

export function removeExcludeBlock(
  cwd: string,
  runId: string,
  markerPrefix = defaultMarkerPrefix
): void {
  const excludePath = resolveExcludePath(cwd);
  if (excludePath === undefined) {
    return;
  }

  const content = readExcludeFile(excludePath);
  if (content === undefined) {
    return;
  }

  fs.writeFileSync(excludePath, removeBlock(content, runId, markerPrefix), "utf8");
}
