import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import path from "node:path";
import { appendExcludeBlock, removeExcludeBlock } from "@poe-code/agent-skill-config";
import {
  resolveAgentSupport,
  resolveHookPath,
  supportedHookAgents,
  type AgentHookConfig
} from "./configs.js";
import { hasOwnErrorCode } from "./error-codes.js";
import { readClaudeHooks } from "./read-hooks.js";
import { assertNoSymbolicLink } from "./path-safety.js";
import { symlinkHooks } from "./symlink-hooks.js";
import { transformHooks, type HookDrop } from "./transform-hooks.js";
import { writeCodexHooks } from "./write-hooks.js";

export type BridgeStrategy = "symlink" | "transform";

export interface BridgeHookManifest {
  sourceAgentId: string;
  targetAgentId: string;
  cwd: string;
  runId: string;
  strategy: BridgeStrategy;
  writtenPath?: string;
  generatedEntryIds?: string[];
  drops: HookDrop[];
  symlinkPath?: string;
  symlinkTarget?: string;
  symlinkReplaced?: "none" | "stale-symlink" | "generated-file";
  symlinkCreated?: boolean;
  createdParents?: string[];
  preExistingEvents?: string[];
  preExistingMatchers?: Array<{ event: string; matcher?: string }>;
  fileCreated?: boolean;
}

interface CodexHookHandler {
  statusMessage?: string;
}

interface CodexMatcherGroup {
  matcher?: string;
  hooks: CodexHookHandler[];
}

interface CodexHooksFile {
  hooks?: Record<string, CodexMatcherGroup[]>;
  [key: string]: unknown;
}

const hookExcludeMarkerPrefix = "poe-code-spawn-hooks";

interface BridgeState {
  cleaned?: boolean;
  excludeBlockId?: string;
  ownershipId: string;
}

const bridgeStates = new WeakMap<BridgeHookManifest, BridgeState>();
const liveTransformOwners = new Map<string, Set<string>>();

function pathExists(targetPath: string): boolean {
  try {
    fs.lstatSync(targetPath);
    return true;
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

function readSymlinkTarget(targetPath: string): string | undefined {
  try {
    return fs.lstatSync(targetPath).isSymbolicLink() ? fs.readlinkSync(targetPath) : undefined;
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return undefined;
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

function requireSupport(input: string, role: "source" | "target") {
  const support = resolveAgentSupport(input);
  if (support.status !== "supported" || !support.id || !support.config) {
    throw new Error(
      `Unsupported ${role} hook agent "${input}". Supported hook agents: ${supportedHookAgents.join(", ")}.`
    );
  }

  return { id: support.id, config: support.config };
}

function requireTargetPath(
  targetId: string,
  config: AgentHookConfig,
  cwd: string,
  homeDir: string
) {
  const targetPath = resolveHookPath(config, "local", cwd, homeDir);
  if (!targetPath) {
    throw new Error(`Agent "${targetId}" has no project hook path`);
  }
  return targetPath;
}

function readCodexFile(targetPath: string): CodexHooksFile | undefined {
  let content: string;
  try {
    content = fs.readFileSync(targetPath, "utf8");
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }

  try {
    return JSON.parse(content) as CodexHooksFile;
  } catch (error) {
    throw new Error(`Malformed JSON in ${targetPath}`, { cause: error });
  }
}

function writeCodexFile(targetPath: string, file: CodexHooksFile): void {
  const temporaryPath = `${targetPath}.cleanup-${process.pid}-${randomUUID()}.tmp`;
  assertNoSymbolicLink(temporaryPath);
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
  } catch (error) {
    if (!hasOwnErrorCode(error, "EEXIST")) {
      try {
        fs.unlinkSync(temporaryPath);
      } catch (cleanupError) {
        void cleanupError;
      }
    }
    throw error;
  }
  try {
    fs.renameSync(temporaryPath, targetPath);
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch (cleanupError) {
      void cleanupError;
    }
    throw error;
  }
}

function hasOnlyEmptyHooks(file: CodexHooksFile): boolean {
  return (
    Object.keys(file).every((key) => key === "hooks") &&
    Object.values(file.hooks ?? {}).every((groups) => groups.length === 0)
  );
}

function relativeToCwd(cwd: string, targetPath: string): string {
  return path.relative(cwd, targetPath);
}

function matcherKey(event: string, matcher: string | undefined): string {
  return `${event}\u0000${matcher === undefined ? "<undefined>" : matcher}`;
}

function acquireOwnershipId(targetPath: string, runId: string): { id: string; overlaps: boolean } {
  const owners = liveTransformOwners.get(targetPath) ?? new Set<string>();
  const overlaps = owners.size > 0;
  let id = runId;
  let suffix = 1;
  while (owners.has(id)) {
    id = `${runId}:${suffix}`;
    suffix += 1;
  }
  owners.add(id);
  liveTransformOwners.set(targetPath, owners);
  return { id, overlaps };
}

function releaseOwnership(targetPath: string, ownershipId: string): void {
  const owners = liveTransformOwners.get(targetPath);
  owners?.delete(ownershipId);
  if (owners?.size === 0) {
    liveTransformOwners.delete(targetPath);
  }
}

export function bridgeHooks(
  sourceAgentId: string,
  targetAgentId: string,
  cwd: string,
  homeDir: string,
  runId: string,
  opts?: { strategy?: BridgeStrategy; scope?: "project" | "user" | "merged" }
): BridgeHookManifest {
  const source = requireSupport(sourceAgentId, "source");
  const target = requireSupport(targetAgentId, "target");
  const strategy =
    opts?.strategy ?? (source.config.format === target.config.format ? "symlink" : "transform");
  const manifest: BridgeHookManifest = {
    sourceAgentId,
    targetAgentId,
    cwd,
    runId,
    strategy,
    drops: []
  };

  if (strategy === "symlink") {
    const symlinkPath = requireTargetPath(target.id, target.config, cwd, homeDir);
    assertNoSymbolicLink(path.dirname(symlinkPath), { root: cwd });
    const preExistingSymlinkTarget = readSymlinkTarget(symlinkPath);
    manifest.createdParents = collectMissingParents(symlinkPath);
    const result = symlinkHooks(source.id, target.id, cwd, homeDir, "project");
    manifest.symlinkPath = result.symlinkPath;
    manifest.symlinkTarget = result.targetPath;
    manifest.symlinkReplaced = result.replaced;
    manifest.symlinkCreated = !(
      result.replaced === "none" && preExistingSymlinkTarget === result.targetPath
    );
    try {
      const excludeBlockId = appendExcludeBlock(cwd, runId, [relativeToCwd(cwd, result.symlinkPath)], {
        markerPrefix: hookExcludeMarkerPrefix
      });
      bridgeStates.set(manifest, { ownershipId: runId, excludeBlockId });
    } catch (error) {
      if (fs.lstatSync(result.symlinkPath).isSymbolicLink()) {
        fs.unlinkSync(result.symlinkPath);
      }
      throw error;
    }
    return manifest;
  }

  if (source.id !== "claude-code") {
    throw new Error(`Transforming hooks from "${source.id}" is not supported yet`);
  }

  if (target.config.format !== "codex-hooks-json") {
    throw new Error(
      `Transforming hooks to "${target.id}" is not supported yet; only codex-hook targets can be written`
    );
  }

  const targetPath = requireTargetPath(target.id, target.config, cwd, homeDir);
  assertNoSymbolicLink(path.dirname(targetPath), { root: cwd });
  const priorFile = readCodexFile(targetPath);
  const sourceHooks = readClaudeHooks(cwd, homeDir, { scope: opts?.scope ?? "merged" });
  const ownership = acquireOwnershipId(targetPath, runId);
  const transformed = transformHooks(sourceHooks.entries, source.id, target.id, { runId: ownership.id });
  const createdParents = collectMissingParents(targetPath);
  let writeResult;
  try {
    writeResult = writeCodexHooks(targetPath, transformed.entries, ownership.id, {
      preserveGenerated: ownership.overlaps
    });
  } catch (error) {
    releaseOwnership(targetPath, ownership.id);
    throw error;
  }

  manifest.writtenPath = targetPath;
  manifest.generatedEntryIds = transformed.entries.map((entry) => entry.generatedId);
  manifest.drops = transformed.drops;
  manifest.createdParents = createdParents;
  manifest.fileCreated = writeResult.fileCreated;
  manifest.preExistingEvents = Object.keys(priorFile?.hooks ?? {});
  manifest.preExistingMatchers = Object.entries(priorFile?.hooks ?? {}).flatMap(([event, groups]) =>
    groups.map((group) => ({
      event,
      ...(group.matcher === undefined ? {} : { matcher: group.matcher })
    }))
  );
  try {
    const excludeBlockId = appendExcludeBlock(cwd, runId, [relativeToCwd(cwd, targetPath)], {
      markerPrefix: hookExcludeMarkerPrefix
    });
    bridgeStates.set(manifest, { ownershipId: ownership.id, excludeBlockId });
  } catch (error) {
    releaseOwnership(targetPath, ownership.id);
    if (priorFile) {
      writeCodexFile(targetPath, priorFile);
    } else {
      fs.unlinkSync(targetPath);
    }
    for (const parent of [...createdParents].reverse()) {
      removeDirectoryIfEmpty(parent);
    }
    throw error;
  }

  return manifest;
}

export function cleanupBridgedHooks(manifest: BridgeHookManifest): void {
  const state = bridgeStates.get(manifest);
  if (state?.cleaned) {
    return;
  }
  if (manifest.strategy === "symlink" && manifest.symlinkPath && manifest.symlinkTarget) {
    if (manifest.symlinkCreated !== false) {
      try {
        if (
          fs.lstatSync(manifest.symlinkPath).isSymbolicLink() &&
          fs.readlinkSync(manifest.symlinkPath) === manifest.symlinkTarget
        ) {
          fs.unlinkSync(manifest.symlinkPath);
        }
      } catch (error) {
        if (!hasOwnErrorCode(error, "ENOENT")) {
          throw error;
        }
      }

      for (const parent of [...(manifest.createdParents ?? [])].reverse()) {
        removeDirectoryIfEmpty(parent);
      }
    }
  }

  if (manifest.strategy === "transform" && manifest.writtenPath) {
    const file = readCodexFile(manifest.writtenPath);
    if (file) {
      const generatedPrefix = `[generated:poe-code:${state?.ownershipId ?? manifest.runId}]`;
      const preExistingEvents = new Set(manifest.preExistingEvents ?? []);
      const preExistingMatchers = new Set(
        (manifest.preExistingMatchers ?? []).map((group) => matcherKey(group.event, group.matcher))
      );
      const hooks = file.hooks ?? {};

      for (const [event, groups] of Object.entries(hooks)) {
        hooks[event] = groups.filter((group) => {
          const priorLength = group.hooks.length;
          group.hooks = group.hooks.filter(
            (handler) => !handler.statusMessage?.startsWith(generatedPrefix)
          );
          return (
            group.hooks.length > 0 ||
            group.hooks.length === priorLength ||
            preExistingMatchers.has(matcherKey(event, group.matcher))
          );
        });

        if (hooks[event].length === 0 && !preExistingEvents.has(event)) {
          delete hooks[event];
        }
      }

      file.hooks = hooks;
      if (manifest.fileCreated && hasOnlyEmptyHooks(file)) {
        fs.unlinkSync(manifest.writtenPath);
      } else {
        writeCodexFile(manifest.writtenPath, file);
      }
    }

    for (const parent of [...(manifest.createdParents ?? [])].reverse()) {
      removeDirectoryIfEmpty(parent);
    }
    releaseOwnership(manifest.writtenPath, state?.ownershipId ?? manifest.runId);
  }

  removeExcludeBlock(manifest.cwd, state?.excludeBlockId ?? manifest.runId, { markerPrefix: hookExcludeMarkerPrefix });
  if (state) {
    state.cleaned = true;
  }
}
