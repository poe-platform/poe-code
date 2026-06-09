import * as fs from "node:fs/promises";
import path from "node:path";
import { countTokens } from "tokenfill";
import { hasOwnErrorCode } from "./errors.js";
import { listPages } from "./pages.js";
import type { MemoryRoot, TokenStats } from "./types.js";

export async function computeTokenStats(root: MemoryRoot): Promise<TokenStats> {
  if (!(await pathExists(root))) {
    return {
      memoryTokens: 0,
      sourceTokens: 0,
      reductionRatio: 0,
      missingSources: []
    };
  }

  const pages = await listPages(root);

  let memoryTokens = 0;
  const sourcePaths = new Set<string>();

  for (const page of pages) {
    memoryTokens += countTokens(page.body);
    for (const source of page.frontmatter.sources ?? []) {
      const normalized = source.path.trim();
      if (normalized.length > 0) {
        sourcePaths.add(normalized);
      }
    }
  }

  const repoRoot = path.resolve(root, "..", "..");

  let sourceTokens = 0;
  const missingSources: string[] = [];

  for (const sourcePath of sourcePaths) {
    if (isUrlLike(sourcePath)) {
      continue;
    }

    if (path.isAbsolute(sourcePath)) {
      missingSources.push(sourcePath);
      continue;
    }

    const absPath = path.resolve(repoRoot, sourcePath);
    if (!isWithinRoot(repoRoot, absPath)) {
      missingSources.push(sourcePath);
      continue;
    }

    try {
      const realPath = await fs.realpath(absPath);
      if (!isWithinRoot(repoRoot, realPath)) {
        missingSources.push(sourcePath);
        continue;
      }
      const content = await fs.readFile(absPath, "utf8");
      sourceTokens += countTokens(content);
    } catch (error) {
      if (isMissing(error)) {
        missingSources.push(sourcePath);
        continue;
      }
      throw error;
    }
  }

  missingSources.sort((left, right) => left.localeCompare(right));

  const reductionRatio =
    sourceTokens === 0 ? 0 : sourceTokens / Math.max(memoryTokens, 1);

  return {
    memoryTokens,
    sourceTokens,
    reductionRatio,
    missingSources
  };
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath);
    return true;
  } catch (error) {
    if (isMissing(error)) {
      return false;
    }
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT");
}

function isUrlLike(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol.length > 1 && value.includes("://");
  } catch {
    return false;
  }
}

function isWithinRoot(root: string, absPath: string): boolean {
  const relative = path.relative(root, absPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
