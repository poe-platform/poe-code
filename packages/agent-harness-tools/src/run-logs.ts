import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { hasOwnErrorCode } from "./error-codes.js";
import { assertContainedPath } from "./path-boundary.js";

export interface ResolveRunLogDirOptions {
  planPath: string;
  runner: string;
  homeDir: string;
}

export interface RunLogFileSystem {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  realpath?(path: string): Promise<string>;
}

export function resolveRunLogDir(options: ResolveRunLogDirOptions): string {
  const slug = slugifyPlanPath(options.planPath);
  const logRoot = path.join(options.homeDir, ".poe-code", "logs");
  const runLogDir = path.join(logRoot, options.runner, slug);
  assertContainedPath(logRoot, runLogDir, "Runner must remain within the log root");
  return runLogDir;
}

export async function ensureSafeRunLogDir(
  options: ResolveRunLogDirOptions & { fs?: RunLogFileSystem }
): Promise<string> {
  const stateDir = path.join(options.homeDir, ".poe-code");
  const logRoot = path.join(stateDir, "logs");
  const runLogDir = resolveRunLogDir(options);
  const fs = options.fs ?? defaultRunLogFs;

  await fs.mkdir(stateDir, { recursive: true });
  await fs.mkdir(logRoot, { recursive: true });
  await assertExistingPathContained(fs, stateDir, logRoot);
  await assertExistingRunLogAncestorsContained(fs, stateDir, logRoot, runLogDir);
  await fs.mkdir(runLogDir, { recursive: true });
  await assertExistingPathContained(fs, stateDir, runLogDir);

  return runLogDir;
}

export function slugifyPlanPath(planPath: string): string {
  const base = path.basename(planPath);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const label = slugifyLabel(stem) || "plan";
  const pathDigest = createHash("sha256")
    .update(normalizePlanPathForSlug(planPath))
    .digest("hex")
    .slice(0, 12);
  return `${label}-${pathDigest}`;
}

export function makeRunLogFileName(role: string, date: Date = new Date()): string {
  const day = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1, 2)}${pad(date.getUTCDate(), 2)}`;
  const time = `${pad(date.getUTCHours(), 2)}${pad(date.getUTCMinutes(), 2)}${pad(date.getUTCSeconds(), 2)}`;
  const ms = pad(date.getUTCMilliseconds(), 3);
  const safeRole = slugifyLabel(role) || "role";
  return `${day}-${time}-${ms}-${safeRole}.jsonl`;
}

function slugifyLabel(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    const lower = code >= 97 && code <= 122;
    const upper = code >= 65 && code <= 90;
    const digit = code >= 48 && code <= 57;

    if (lower || digit) {
      out += char;
    } else if (upper) {
      out += String.fromCharCode(code + 32);
    } else if (char === "-" || char === "_") {
      out += char;
    } else {
      out += "-";
    }
  }

  return collapseDashes(out).replace(/^-+|-+$/g, "");
}

async function assertExistingRunLogAncestorsContained(
  fs: RunLogFileSystem,
  stateDir: string,
  logRoot: string,
  runLogDir: string
): Promise<void> {
  const relativeRunLogDir = path.relative(logRoot, runLogDir);
  const segments = relativeRunLogDir.split(path.sep).filter(Boolean);
  let currentPath = logRoot;

  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);
    const exists = await assertExistingPathContained(fs, stateDir, currentPath, {
      ignoreMissing: true
    });
    if (!exists) {
      return;
    }
  }
}

async function assertExistingPathContained(
  fs: RunLogFileSystem,
  stateDir: string,
  candidatePath: string,
  opts: { ignoreMissing?: boolean } = {}
): Promise<boolean> {
  try {
    const resolveRealpath = fs.realpath ?? resolveLexicalRealpath;
    const [canonicalStateDir, canonicalCandidatePath] = await Promise.all([
      resolveRealpath(stateDir),
      resolveRealpath(candidatePath)
    ]);
    assertContainedPath(
      canonicalStateDir,
      canonicalCandidatePath,
      "Runner log directory resolves outside the poe-code state directory"
    );
    return true;
  } catch (error) {
    if (opts.ignoreMissing && isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

function isNotFoundError(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT");
}

const defaultRunLogFs: RunLogFileSystem = {
  mkdir: async (target, options) => {
    await mkdir(target, options);
  },
  realpath: async (target) => realpath(target)
};

async function resolveLexicalRealpath(target: string): Promise<string> {
  return path.resolve(target);
}

function normalizePlanPathForSlug(planPath: string): string {
  const resolvedPath = path.isAbsolute(planPath) ? planPath : path.resolve(planPath);
  return path.normalize(resolvedPath);
}

function collapseDashes(value: string): string {
  let out = "";
  let prevDash = false;
  for (const char of value) {
    if (char === "-") {
      if (!prevDash) {
        out += "-";
      }
      prevDash = true;
    } else {
      out += char;
      prevDash = false;
    }
  }
  return out;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}
