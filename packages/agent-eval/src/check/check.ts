import { cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { hasOwnErrorCode } from "../error-codes.js";
import { loadSourceConfig } from "../source/config.js";
import { openSource } from "../source/open.js";
import { loadEval } from "../source/registry.js";
import type { CaseResult } from "../run/vitest-runner.js";
import { cloneTarget } from "../run/clone.js";
import { runScorer } from "../run/scorer.js";
import {
  assertCanonicalContainedPath,
  assertCanonicalDestinationPath,
  resolveContainedPath
} from "../path-boundary.js";
import { assertNoSymlinksInDirectoryTree } from "../run/fixture-copy.js";

export interface CheckOptions {
  sourceDir: string;
  evalId: string;
  signal?: AbortSignal;
}

export interface CheckResult {
  evalId: string;
  cloneDir: string;
  tests: { passed: number; total: number; cases: CaseResult[] };
  durationMs: number;
}

export async function evalCheck(opts: CheckOptions): Promise<CheckResult> {
  const startedAt = Date.now();
  const source = await openSource(opts.sourceDir);
  const evalDef = await loadEval(source, opts.evalId);
  const config = await loadSourceConfig(source);
  const outDir = resolveOutputDirectory(source.rootDir, config.out);
  const cloneDir = path.join(outDir, ".check", opts.evalId, isoUtcSafe(new Date()), "clone");

  opts.signal?.throwIfAborted();
  await mkdir(path.dirname(cloneDir), { recursive: true });
  await cloneTarget({
    repo: evalDef.target.repo,
    ref: evalDef.target.ref,
    dest: cloneDir,
    signal: opts.signal
  });
  opts.signal?.throwIfAborted();

  const evalDir = path.join(source.rootDir, opts.evalId);
  const oracleDir = resolveContainedPath(evalDir, evalDef.oracle.path, "oracle.path");
  await assertCanonicalContainedPath(evalDir, oracleDir, "oracle.path");
  await copyDirectoryIfPresent(path.join(evalDir, "starter"), cloneDir);
  opts.signal?.throwIfAborted();
  await copyOracleSolution({
    solutionDir: path.join(oracleDir, "solution"),
    cloneDir,
    solutionDest: evalDef.oracle.solutionDest
  });
  opts.signal?.throwIfAborted();

  const tests = await runScorer({
    evalDef,
    evalDir,
    cloneDir,
    signal: opts.signal
  });

  return {
    evalId: opts.evalId,
    cloneDir,
    tests,
    durationMs: Date.now() - startedAt
  };
}

function resolveOutputDirectory(sourceDir: string, outDir: string): string {
  return path.isAbsolute(outDir) ? outDir : path.resolve(sourceDir, outDir);
}

function isoUtcSafe(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

async function copyDirectoryIfPresent(sourceDir: string, destDir: string): Promise<void> {
  try {
    const sourceStat = await stat(sourceDir);
    if (!sourceStat.isDirectory()) {
      return;
    }
  } catch (error) {
    if (isMissingPath(error)) {
      return;
    }
    throw error;
  }

  await assertNoSymlinksInDirectoryTree(sourceDir, "starter");
  await cp(sourceDir, destDir, {
    recursive: true,
    force: true
  });
}

async function copyOracleSolution(input: {
  solutionDir: string;
  cloneDir: string;
  solutionDest: string;
}): Promise<void> {
  const destDir = resolveCloneRelativePath(input.cloneDir, input.solutionDest);
  await assertCanonicalDestinationPath(input.cloneDir, destDir, "oracle.solution_dest");
  await mkdir(destDir, { recursive: true });
  await assertNoSymlinksInDirectoryTree(input.solutionDir, "oracle.solution");
  await cp(input.solutionDir, destDir, {
    recursive: true,
    force: true
  });
}

function resolveCloneRelativePath(cloneDir: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`oracle.solution_dest must be relative to the clone root.`);
  }

  const resolved = path.resolve(cloneDir, relativePath);
  const relative = path.relative(cloneDir, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`oracle.solution_dest must stay within the clone root.`);
  }

  return resolved;
}

function isMissingPath(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT") || hasOwnErrorCode(error, "ENOTDIR");
}
