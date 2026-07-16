import * as fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import {
  getAgentConfig,
  resolveAgentSupport,
  resolveSkillDir,
  supportedAgents
} from "./configs.js";
import { UserError } from "@poe-code/user-error";
import { hasOwnErrorCode } from "./error-codes.js";
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
  excludeBlockId?: string;
  entries: BridgeEntry[];
  warnings: BridgeWarning[];
}

interface ActiveTarget {
  createdParents: string[];
  fingerprint: string;
  sourceFingerprint: string;
  sourcePath: string;
  references: number;
  token: string;
}

interface ManifestState {
  excludeBlockId?: string;
  cleaned?: boolean;
}

const activeTargets = new Map<string, ActiveTarget>();
const manifestStates = new WeakMap<BridgeManifest, ManifestState>();
const ownershipFileName = ".poe-code-bridge-owner";

type ResolvedSkill = Extract<ReturnType<typeof resolveSkillReference>, { kind: "resolved" }>;

interface ResolvedBridgeSource {
  ref: string;
  source: ResolvedSkill;
  targetPath: string;
  globalTargetPath: string;
}

function pathExists(targetPath: string): boolean {
  try {
    fs.statSync(targetPath);
    return true;
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

function assertNoSymbolicLinkUnder(rootPath: string, targetPath: string): void {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to bridge skills outside root ${root}: ${target}`);
  }

  let current = root;
  const segments = relative.length === 0 ? [] : relative.split(path.sep);

  for (const segment of segments) {
    if (segment.length === 0) {
      continue;
    }
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new Error(`Refusing to bridge skills through symbolic link: ${current}`);
      }
    } catch (error) {
      if (hasOwnErrorCode(error, "ENOENT")) {
        return;
      }
      throw error;
    }
  }
}

function isDirectory(targetPath: string): boolean {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
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
    lines.push("Install one with poe-code skill install <agent> --name <name> --file <path>.");
  }

  return new UserError(lines.join("\n"));
}

function copyDirectory(sourcePath: string, targetPath: string): void {
  fs.mkdirSync(targetPath, { recursive: true });
  for (const dirent of fs.readdirSync(sourcePath, { withFileTypes: true })) {
    const childSource = path.join(sourcePath, dirent.name);
    const childTarget = path.join(targetPath, dirent.name);

    if (dirent.isSymbolicLink()) {
      throw new Error(`Refusing to bridge skill containing symbolic link: ${childSource}`);
    }

    if (dirent.isDirectory()) {
      copyDirectory(childSource, childTarget);
      continue;
    }

    if (dirent.isFile()) {
      fs.copyFileSync(childSource, childTarget);
      continue;
    }

    throw new Error(`Refusing to bridge unsupported filesystem entry: ${childSource}`);
  }
}

function directoryFingerprint(targetPath: string): string {
  const hash = createHash("sha256");

  function visit(currentPath: string, relativePath: string): void {
    const stats = fs.lstatSync(currentPath);
    if (stats.isSymbolicLink()) {
      throw new Error(`Refusing to inspect bridged skill through symbolic link: ${currentPath}`);
    }
    if (stats.isDirectory()) {
      hash.update(`d:${relativePath}\n`);
      for (const name of fs.readdirSync(currentPath).sort()) {
        visit(path.join(currentPath, name), path.join(relativePath, name));
      }
      return;
    }
    if (stats.isFile()) {
      hash.update(`f:${relativePath}\n`);
      hash.update(fs.readFileSync(currentPath));
      return;
    }
    throw new Error(`Refusing to bridge unsupported filesystem entry: ${currentPath}`);
  }

  visit(targetPath, ".");
  return hash.digest("hex");
}

function ownershipPath(targetPath: string): string {
  return path.join(targetPath, ownershipFileName);
}

function hasOwnershipToken(targetPath: string, token: string): boolean {
  try {
    return fs.readFileSync(ownershipPath(targetPath), "utf8") === token;
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
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
      hasOwnErrorCode(error, "ENOENT") ||
      hasOwnErrorCode(error, "ENOTEMPTY") ||
      hasOwnErrorCode(error, "EEXIST")
    ) {
      return;
    }
    throw error;
  }
}

function removeTarget(targetPath: string): void {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function rollbackEntries(entries: BridgeEntry[]): void {
  for (const entry of [...entries].reverse()) {
    const activeTarget = activeTargets.get(entry.targetPath);
    if (activeTarget && activeTarget.references > 1) {
      activeTarget.references -= 1;
      continue;
    }
    activeTargets.delete(entry.targetPath);
    removeTarget(entry.targetPath);
    for (const parent of [...(activeTarget?.createdParents ?? entry.createdParents)].reverse()) {
      removeDirectoryIfEmpty(parent);
    }
  }
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

  try {
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

      const activeTarget = activeTargets.get(item.targetPath);
      if (activeTarget && pathExists(item.targetPath)) {
        if (activeTarget.sourcePath === item.source.sourcePath) {
          const sourceRoot = item.source.scope === "project" ? cwd : homeDir;
          assertNoSymbolicLinkUnder(sourceRoot, item.source.sourcePath);
          const sourceFingerprint = directoryFingerprint(item.source.sourcePath);
          if (
            sourceFingerprint === activeTarget.sourceFingerprint &&
            hasOwnershipToken(item.targetPath, activeTarget.token) &&
            directoryFingerprint(item.targetPath) === activeTarget.fingerprint
          ) {
            activeTarget.references += 1;
            claimedTargets.add(item.targetPath);
            entries.push({
              ref: item.ref,
              sourcePath: item.source.sourcePath,
              targetPath: item.targetPath,
              createdParents: []
            });
            continue;
          }

          warnings.push(
            warning("local-collision", item.ref, item.source.sourcePath, item.targetPath)
          );
          continue;
        }
        activeTargets.delete(item.targetPath);
      }

      if (pathExists(item.targetPath)) {
        warnings.push(
          warning("local-collision", item.ref, item.source.sourcePath, item.targetPath)
        );
        continue;
      }

      if (isDirectory(item.globalTargetPath)) {
        warnings.push(
          warning("global-collision", item.ref, item.source.sourcePath, item.globalTargetPath)
        );
        continue;
      }

      const sourceRoot = item.source.scope === "project" ? cwd : homeDir;
      assertNoSymbolicLinkUnder(sourceRoot, item.source.sourcePath);
      const sourceFingerprint = directoryFingerprint(item.source.sourcePath);
      const createdParents = collectMissingParents(item.targetPath);
      assertNoSymbolicLinkUnder(cwd, path.dirname(item.targetPath));
      fs.mkdirSync(path.dirname(item.targetPath), { recursive: true });
      const token = randomUUID();
      try {
        copyDirectory(item.source.sourcePath, item.targetPath);
        fs.writeFileSync(ownershipPath(item.targetPath), token, "utf8");
        const fingerprint = directoryFingerprint(item.targetPath);
        claimedTargets.add(item.targetPath);
        entries.push({
          ref: item.ref,
          sourcePath: item.source.sourcePath,
          targetPath: item.targetPath,
          createdParents
        });
        activeTargets.set(item.targetPath, {
          createdParents,
          fingerprint,
          sourceFingerprint,
          sourcePath: item.source.sourcePath,
          references: 1,
          token
        });
      } catch (error) {
        removeTarget(item.targetPath);
        for (const parent of [...createdParents].reverse()) {
          removeDirectoryIfEmpty(parent);
        }
        throw error;
      }
    }

    let excludeBlockId: string | undefined;
    if (entries.length > 0) {
      excludeBlockId = appendExcludeBlock(
        cwd,
        runId,
        entries.map((entry) => toCwdRelative(cwd, entry.targetPath))
      );
    }

    const manifest = {
      spawnAgentId,
      cwd,
      runId,
      ...(excludeBlockId !== undefined && excludeBlockId !== runId ? { excludeBlockId } : {}),
      entries,
      warnings
    };
    manifestStates.set(manifest, { excludeBlockId });
    return manifest;
  } catch (error) {
    rollbackEntries(entries);
    throw error;
  }
}

export function cleanupBridgedSkills(manifest: BridgeManifest): void {
  const state = manifestStates.get(manifest);
  if (state?.cleaned) {
    return;
  }
  removeExcludeBlock(
    manifest.cwd,
    state?.excludeBlockId ?? manifest.excludeBlockId ?? manifest.runId
  );
  for (const entry of manifest.entries) {
    const activeTarget = activeTargets.get(entry.targetPath);
    if (!activeTarget) {
      continue;
    }
    if (activeTarget.references > 1) {
      activeTarget.references -= 1;
      continue;
    }
    activeTargets.delete(entry.targetPath);
    if (
      pathExists(entry.targetPath) &&
      hasOwnershipToken(entry.targetPath, activeTarget.token) &&
      directoryFingerprint(entry.targetPath) === activeTarget.fingerprint
    ) {
      removeTarget(entry.targetPath);
      for (const parent of [...activeTarget.createdParents].reverse()) {
        removeDirectoryIfEmpty(parent);
      }
    }
  }
  if (state) {
    state.cleaned = true;
  }
}
