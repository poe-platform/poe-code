import * as fs from "node:fs/promises";
import path from "node:path";
import { parseClaims } from "./confidence.js";
import { hasOwnErrorCode } from "./errors.js";
import { serializeSourceRef } from "./frontmatter.js";
import { listPages } from "./pages.js";
import type { MemoryRoot, SourceRef } from "./types.js";

const DEFAULT_MIN_INFERRED_CONFIDENCE = 0.3;
const DEFAULT_REJECT_UNTAGGED = false;
const DEFAULT_UNTAGGED_BODY_THRESHOLD_CHARS = 200;

export type AuditClaimsOptions = {
  minInferredConfidence?: number;
  rejectUntagged?: boolean;
  untaggedBodyThresholdChars?: number;
};

export type PageAudit = {
  page: string;
  issues: string[];
};

type SourceFileMeta =
  | { exists: false; absPath: string; symbolicLinkEscape?: true }
  | { exists: true; absPath: string; lineCount: number };

export async function auditClaims(
  root: MemoryRoot,
  repoRoot: string,
  options: AuditClaimsOptions = {}
): Promise<PageAudit[]> {
  const minInferredConfidence =
    options.minInferredConfidence ?? DEFAULT_MIN_INFERRED_CONFIDENCE;
  const rejectUntagged = options.rejectUntagged ?? DEFAULT_REJECT_UNTAGGED;
  const untaggedBodyThresholdChars =
    options.untaggedBodyThresholdChars ?? DEFAULT_UNTAGGED_BODY_THRESHOLD_CHARS;
  const sourceCache = new Map<string, Promise<SourceFileMeta>>();

  const pages = await listPages(root);
  const audits: PageAudit[] = [];

  for (const page of pages) {
    const issues: string[] = [];
    let claims;

    try {
      claims = parseClaims(page.body);
    } catch (error) {
      issues.push(formatError(error));
      audits.push({ page: page.relPath, issues });
      continue;
    }

    if (rejectUntagged && claims.length === 0 && page.body.trim().length > untaggedBodyThresholdChars) {
      issues.push(
        `Page has a long untagged body (>${untaggedBodyThresholdChars} chars) with no memory:* tags.`
      );
    }

    const inlineSources = new Set<string>();

    for (const claim of claims) {
      if (claim.tag.verb === "inferred" && claim.tag.confidence < minInferredConfidence) {
        issues.push(
          `Claim on line ${claim.lineNumber} uses inferred confidence=${claim.tag.confidence}, below the minimum ${minInferredConfidence}.`
        );
      }

      const source = "source" in claim.tag ? claim.tag.source : undefined;
      if (source === undefined) {
        continue;
      }

      const serializedSource = serializeSourceRef(source);
      inlineSources.add(serializedSource);

      const sourceIssue = await auditSourceRef(source, claim.lineNumber, repoRoot, sourceCache);
      if (sourceIssue !== undefined) {
        issues.push(sourceIssue);
      }
    }

    issues.push(...auditFrontmatterSources(page.frontmatter.sources ?? [], inlineSources));

    if (issues.length > 0) {
      audits.push({ page: page.relPath, issues });
    }
  }

  return audits;
}

async function auditSourceRef(
  source: SourceRef,
  claimLineNumber: number,
  repoRoot: string,
  sourceCache: Map<string, Promise<SourceFileMeta>>
): Promise<string | undefined> {
  if (isUrlLike(source.path)) {
    return undefined;
  }

  if (path.isAbsolute(source.path)) {
    return `Claim on line ${claimLineNumber} cites "${serializeSourceRef(source)}", but source paths must be repo-relative or URLs.`;
  }

  const absPath = path.resolve(repoRoot, source.path);
  if (!isWithinRoot(repoRoot, absPath)) {
    return `Claim on line ${claimLineNumber} cites "${serializeSourceRef(source)}", which resolves outside the repo root.`;
  }

  const meta = await readSourceFile(absPath, repoRoot, sourceCache);
  if (!meta.exists && meta.symbolicLinkEscape === true) {
    return `Claim on line ${claimLineNumber} cites "${serializeSourceRef(source)}", but the source traverses a symbolic link outside the repo root.`;
  }

  if (!meta.exists) {
    return `Claim on line ${claimLineNumber} cites "${serializeSourceRef(source)}", resolved to "${meta.absPath}", but the file does not exist.`;
  }

  const lastReferencedLine = source.endLine ?? source.startLine;
  if (lastReferencedLine !== undefined && lastReferencedLine > meta.lineCount) {
    return `Claim on line ${claimLineNumber} cites "${serializeSourceRef(source)}", but current EOF ${meta.lineCount} is before the referenced line.`;
  }

  return undefined;
}

function auditFrontmatterSources(frontmatterSources: SourceRef[], inlineSources: Set<string>): string[] {
  const serializedFrontmatterSources = new Set(frontmatterSources.map((source) => serializeSourceRef(source)));
  const issues: string[] = [];

  const missingSources = [...inlineSources].filter((source) => !serializedFrontmatterSources.has(source));
  for (const source of missingSources.sort((left, right) => left.localeCompare(right))) {
    issues.push(`Page frontmatter sources are missing "${source}" from inline tags.`);
  }

  const staleSources = [...serializedFrontmatterSources].filter((source) => !inlineSources.has(source));
  for (const source of staleSources.sort((left, right) => left.localeCompare(right))) {
    issues.push(`Page frontmatter sources contain stale entry "${source}" not found in inline tags.`);
  }

  return issues;
}

function readSourceFile(
  absPath: string,
  repoRoot: string,
  sourceCache: Map<string, Promise<SourceFileMeta>>
): Promise<SourceFileMeta> {
  const cached = sourceCache.get(absPath);
  if (cached !== undefined) {
    return cached;
  }

  const pending = (async (): Promise<SourceFileMeta> => {
    try {
      const realPath = await fs.realpath(absPath);
      if (!isWithinRoot(repoRoot, realPath)) {
        return {
          exists: false as const,
          absPath,
          symbolicLinkEscape: true as const
        };
      }

      const content = await fs.readFile(absPath, "utf8");
      return {
        exists: true as const,
        absPath,
        lineCount: countLines(content)
      };
    } catch (error) {
      if (isMissing(error)) {
        return {
          exists: false as const,
          absPath
        };
      }

      throw error;
    }
  })();

  sourceCache.set(absPath, pending);
  return pending;
}

function countLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }

  const normalized = content.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const trimmed = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  return trimmed.length === 0 ? 0 : trimmed.split("\n").length;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissing(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT");
}

function isUrlLike(value: string): boolean {
  return /^[a-z][a-z\d+.-]*:\/\//i.test(value);
}

function isWithinRoot(root: string, absPath: string): boolean {
  const relative = path.relative(root, absPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
