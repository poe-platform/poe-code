import * as fs from "node:fs";
import path from "node:path";
import {
  getAgentConfig,
  resolveAgentSupport,
  resolveSkillDir,
  supportedAgents
} from "./configs.js";
import { appendExcludeBlock, removeExcludeBlock } from "./git-exclude.js";
import { resolveSkillReference, type SkillResolutionFailure } from "./resolve-skill-reference.js";

export interface BridgeEntry {
  ref: string;
  sourcePath: string;
  targetPath: string;
  createdParents: string[];
}

export type BridgeWarningKind =
  | "local-collision"
  | "global-collision"
  | "self-reference"
  | "intra-batch-collision";

export interface BridgeWarning {
  kind: BridgeWarningKind;
  ref: string;
  sourcePath: string;
  conflictingPath: string;
  message: string;
}

export interface BridgeManifest {
  spawnAgentId: string;
  cwd: string;
  runId: string;
  entries: BridgeEntry[];
  warnings: BridgeWarning[];
}

type ResolvedSkill = Extract<ReturnType<typeof resolveSkillReference>, { kind: "resolved" }>;

interface ResolvedBridgeSource {
  ref: string;
  source: ResolvedSkill;
  targetPath: string;
  globalTargetPath: string;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function pathExists(targetPath: string): boolean {
  try {
    fs.statSync(targetPath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function isDirectory(targetPath: string): boolean {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function formatResolutionFailureError(failures: SkillResolutionFailure[]): Error {
  const malformed = failures.filter((failure) => failure.kind === "malformed");
  const unknownAgent = failures.filter((failure) => failure.kind === "unknown-agent");
  const notFound = failures.filter((failure) => failure.kind === "not-found");
  const lines = [
    `Failed to bridge active skills: ${failures.length} skill reference(s) could not be resolved.`
  ];

  if (malformed.length > 0) {
    lines.push("", "Malformed skill references:");
    for (const failure of malformed) {
      lines.push(`- ${failure.ref}`);
    }
    lines.push('Expected syntax: "<name>" or "<agentId>/<name>".');
  }

  if (unknownAgent.length > 0) {
    lines.push("", "Unknown agent references:");
    for (const failure of unknownAgent) {
      lines.push(`- ${failure.ref} (agent token: ${failure.agentInput})`);
    }
    lines.push(`Supported agents: ${supportedAgents.join(", ")}.`);
  }

  if (notFound.length > 0) {
    lines.push("", "Not found skill references.");
    for (const failure of notFound) {
      lines.push(`- ${failure.ref}`);
      lines.push("  searched paths:");
      for (const searchedPath of failure.searchedPaths) {
        lines.push(`  - ${searchedPath}`);
      }
    }
  }

  return new Error(lines.join("\n"));
}

function copyDirectory(sourcePath: string, targetPath: string): void {
  fs.mkdirSync(targetPath, { recursive: true });
  for (const dirent of fs.readdirSync(sourcePath, { withFileTypes: true })) {
    const childSource = path.join(sourcePath, dirent.name);
    const childTarget = path.join(targetPath, dirent.name);

    if (dirent.isDirectory()) {
      copyDirectory(childSource, childTarget);
      continue;
    }

    if (dirent.isFile()) {
      fs.copyFileSync(childSource, childTarget);
    }
  }
}

function collectMissingParents(targetPath: string): string[] {
  const parents: string[] = [];
  let current = path.dirname(targetPath);

  while (!pathExists(current)) {
    parents.push(current);
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return parents.reverse();
}

function removeDirectoryIfEmpty(targetPath: string): void {
  try {
    fs.rmdirSync(targetPath);
  } catch (error) {
    if (
      isNodeError(error) &&
      (error.code === "ENOENT" || error.code === "ENOTEMPTY" || error.code === "EEXIST")
    ) {
      return;
    }
    throw error;
  }
}

function removeTarget(targetPath: string): void {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function toCwdRelative(cwd: string, targetPath: string): string {
  return path.relative(cwd, targetPath);
}

function warning(
  kind: BridgeWarningKind,
  ref: string,
  sourcePath: string,
  conflictingPath: string
): BridgeWarning {
  const messages: Record<BridgeWarningKind, string> = {
    "intra-batch-collision": `Skipping ${ref}: an earlier bridged skill already targets ${conflictingPath}.`,
    "local-collision": `Skipping ${ref}: local skill already exists at ${conflictingPath}.`,
    "global-collision": `Skipping ${ref}: global skill already exists at ${conflictingPath}.`,
    "self-reference": `Skipping ${ref}: spawning agent already sees this native skill at ${conflictingPath}.`
  };

  return {
    kind,
    ref,
    sourcePath,
    conflictingPath,
    message: messages[kind]
  };
}

export function bridgeActiveSkills(
  spawnAgentId: string,
  cwd: string,
  refs: string[],
  homeDir: string,
  runId: string
): BridgeManifest {
  const spawnConfig = getAgentConfig(spawnAgentId);
  const spawnSupport = resolveAgentSupport(spawnAgentId);
  if (!spawnConfig || spawnSupport.status !== "supported" || !spawnSupport.id) {
    throw new Error(
      `Unsupported spawn agent "${spawnAgentId}". Supported agents: ${supportedAgents.join(", ")}.`
    );
  }

  const targetDir = resolveSkillDir(spawnConfig, "local", cwd);
  const globalTargetDir = resolveSkillDir(spawnConfig, "global", cwd, homeDir);
  const resolutions = refs.map((ref) => resolveSkillReference(ref, cwd, homeDir));
  const failures = resolutions.filter(
    (resolution): resolution is SkillResolutionFailure => resolution.kind !== "resolved"
  );
  if (failures.length > 0) {
    throw formatResolutionFailureError(failures);
  }

  const sources: ResolvedBridgeSource[] = resolutions.map((source, index) => ({
    ref: refs[index]!,
    source: source as ResolvedSkill,
    targetPath: path.resolve(targetDir, (source as ResolvedSkill).name),
    globalTargetPath: path.resolve(globalTargetDir, (source as ResolvedSkill).name)
  }));

  const entries: BridgeEntry[] = [];
  const warnings: BridgeWarning[] = [];
  const claimedTargets = new Set<string>();

  for (const item of sources) {
    if (claimedTargets.has(item.targetPath)) {
      warnings.push(
        warning("intra-batch-collision", item.ref, item.source.sourcePath, item.targetPath)
      );
      continue;
    }

    if (item.source.sourceAgentId === spawnSupport.id) {
      warnings.push(
        warning("self-reference", item.ref, item.source.sourcePath, item.source.sourcePath)
      );
      continue;
    }

    if (pathExists(item.targetPath)) {
      warnings.push(warning("local-collision", item.ref, item.source.sourcePath, item.targetPath));
      continue;
    }

    if (isDirectory(item.globalTargetPath)) {
      warnings.push(
        warning("global-collision", item.ref, item.source.sourcePath, item.globalTargetPath)
      );
      continue;
    }

    const createdParents = collectMissingParents(item.targetPath);
    fs.mkdirSync(path.dirname(item.targetPath), { recursive: true });
    copyDirectory(item.source.sourcePath, item.targetPath);
    claimedTargets.add(item.targetPath);
    entries.push({
      ref: item.ref,
      sourcePath: item.source.sourcePath,
      targetPath: item.targetPath,
      createdParents
    });
  }

  if (entries.length > 0) {
    appendExcludeBlock(
      cwd,
      runId,
      entries.map((entry) => toCwdRelative(cwd, entry.targetPath))
    );
  }

  return {
    spawnAgentId,
    cwd,
    runId,
    entries,
    warnings
  };
}

export function cleanupBridgedSkills(manifest: BridgeManifest): void {
  for (const entry of manifest.entries) {
    removeTarget(entry.targetPath);
    for (const parent of [...entry.createdParents].reverse()) {
      removeDirectoryIfEmpty(parent);
    }
  }

  removeExcludeBlock(manifest.cwd, manifest.runId);
}
