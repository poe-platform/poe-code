import { posixPath as path } from "@poe-code/safe-fs";
import { appendExcludeBlockAsync as appendExcludeBlock, removeExcludeBlockAsync as removeExcludeBlock } from "@poe-code/agent-skill-config";
import {
  canTransform,
  formatSupportedTransformPairs,
  resolveAgentSupport,
  resolveHookPath,
  supportedHookAgents,
  type AgentHookConfig
} from "./configs.js";
import { hasOwnErrorCode } from "./error-codes.js";
import { readClaudeHooks } from "./read-hooks-async.js";
import { assertNoSymbolicLink } from "./path-safety-async.js";
import { symlinkHooks, userAuthoredHookFileCode, type SymlinkResult } from "./symlink-hooks-async.js";
import { transformHooks, type HookDrop } from "./transform-hooks.js";
import { writeCodexHooks } from "./write-hooks-async.js";
import { hookOperations, defaultHookRuntime, exclusiveHooks, type HookOperations, type HookRuntimeOptions } from "./filesystem.js";

/** Strategy a caller can ask for; `auto` picks a working one. */
export type BridgeStrategyRequest = "auto" | "symlink" | "transform";
/** Strategy a run actually resolved to; `skip` means existing hooks were left alone. */
export type BridgeStrategy = "symlink" | "transform" | "skip";

export interface BridgeHookManifest {
  bridgeId?: string;
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
  /** Non-fatal notices raised while bridging, e.g. why `auto` skipped. */
  warnings?: string[];
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

type SymlinkOwnership = { references: number; created: boolean; target: string; parents: string[] };
const providerSymlinks = new WeakMap<object, Map<string, SymlinkOwnership>>();
interface BridgeState {
  symlink?: SymlinkOwnership;
  provider?: object;
  manifest?: BridgeHookManifest;
  cleaned?: boolean;
  excludeBlockId?: string;
  ownershipId: string;
}

const bridgeStates = new WeakMap<BridgeHookManifest, BridgeState>();
const providerManifests = new WeakMap<object, Map<string, BridgeState>>();
function registerManifest(manifest: BridgeHookManifest, state: BridgeState, io: HookOperations): void {
  if (manifest.symlinkPath && manifest.symlinkTarget) {
    let symlinks = providerSymlinks.get(io.provider);
    if (!symlinks) { symlinks = new Map(); providerSymlinks.set(io.provider, symlinks); }
    let owner = symlinks.get(manifest.symlinkPath);
    if (!owner || owner.target !== manifest.symlinkTarget) {
      owner = { references: 0, created: manifest.symlinkCreated !== false, target: manifest.symlinkTarget, parents: manifest.createdParents ?? [] };
      symlinks.set(manifest.symlinkPath, owner);
    }
    owner.references += 1;
    state.symlink = owner;
  }
  state.provider = io.provider;
  state.manifest = structuredClone(manifest);
  bridgeStates.set(manifest, state);
  let states = providerManifests.get(io.provider);
  if (!states) { states = new Map(); providerManifests.set(io.provider, states); }
  states.set(manifest.bridgeId!, state);
}
const providerOwners = new WeakMap<object, Map<string, Set<string>>>();
function ownersFor(io: HookOperations): Map<string, Set<string>> {
  let owners = providerOwners.get(io.provider);
  if (!owners) { owners = new Map(); providerOwners.set(io.provider, owners); }
  return owners;
}

async function pathExists(targetPath: string, io: HookOperations): Promise<boolean> {
  try {
    (await io.lstat(targetPath));
    return true;
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

async function readSymlinkTarget(targetPath: string, io: HookOperations): Promise<string | undefined> {
  try {
    return (await io.lstat(targetPath)).isSymbolicLink() ? (await io.readlink(targetPath)) : undefined;
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }
}

async function collectMissingParents(targetPath: string, io: HookOperations): Promise<string[]> {
  const parents: string[] = [];
  let current = path.dirname(targetPath);

  while (!(await pathExists(current, io))) {
    parents.push(current);
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return parents.reverse();
}

async function removeDirectoryIfEmpty(targetPath: string, io: HookOperations): Promise<void> {
  try {
    (await io.rmdir(targetPath));
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

async function readCodexFile(targetPath: string, io: HookOperations): Promise<CodexHooksFile | undefined> {
  let content: string;
  try {
    content = (await io.readFile(targetPath, "utf8"));
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

async function writeCodexFile(targetPath: string, file: CodexHooksFile, io: HookOperations): Promise<void> {
  const temporaryPath = `${targetPath}.cleanup-${crypto.randomUUID()}.tmp`;
  (await assertNoSymbolicLink(temporaryPath, undefined, io));
  try {
    (await io.writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    }));
  } catch (error) {
    if (!hasOwnErrorCode(error, "EEXIST")) {
      try {
        (await io.unlink(temporaryPath));
      } catch (cleanupError) {
        void cleanupError;
      }
    }
    throw error;
  }
  try {
    (await io.rename(temporaryPath, targetPath));
  } catch (error) {
    try {
      (await io.unlink(temporaryPath));
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

function acquireOwnershipId(targetPath: string, runId: string, io: HookOperations): { id: string; overlaps: boolean } {
  const owners = ownersFor(io).get(targetPath) ?? new Set<string>();
  const overlaps = owners.size > 0;
  let id = runId;
  let suffix = 1;
  while (owners.has(id)) {
    id = `${runId}:${suffix}`;
    suffix += 1;
  }
  owners.add(id);
  ownersFor(io).set(targetPath, owners);
  return { id, overlaps };
}

function releaseOwnership(targetPath: string, ownershipId: string, io: HookOperations): void {
  const owners = ownersFor(io).get(targetPath);
  owners?.delete(ownershipId);
  if (owners?.size === 0) {
    ownersFor(io).delete(targetPath);
  }
}

export async function bridgeHooks(
  sourceAgentId: string,
  targetAgentId: string,
  cwd: string,
  homeDir: string,
  runId: string,
  opts?: { strategy?: BridgeStrategyRequest; scope?: "project" | "user" | "merged" }, runtime: HookRuntimeOptions = defaultHookRuntime()
): Promise<BridgeHookManifest> {
  return exclusiveHooks(runtime, async () => {
    const io = hookOperations(runtime);
    const source = requireSupport(sourceAgentId, "source");
    const target = requireSupport(targetAgentId, "target");
    const requested = opts?.strategy ?? "auto";
    const strategy: BridgeStrategy =
      requested === "auto"
        ? source.config.format === target.config.format
          ? "symlink"
          : "transform"
        : requested;
    const manifest: BridgeHookManifest = {
      bridgeId: crypto.randomUUID(),
      sourceAgentId,
      targetAgentId,
      cwd,
      runId,
      strategy,
      drops: []
    };

    if (strategy === "symlink") {
      const symlinkPath = requireTargetPath(target.id, target.config, cwd, homeDir);
      (await assertNoSymbolicLink(path.dirname(symlinkPath), { root: cwd }, io));
      const preExistingSymlinkTarget = (await readSymlinkTarget(symlinkPath, io));
      manifest.createdParents = (await collectMissingParents(symlinkPath, io));
      let result: SymlinkResult;
      try {
        result = (await symlinkHooks(source.id, target.id, cwd, homeDir, "project", runtime));
      } catch (error) {
        if (requested !== "auto" || !hasOwnErrorCode(error, userAuthoredHookFileCode)) {
          throw error;
        }
        manifest.strategy = "skip";
        manifest.warnings = [
          `Skipped bridging hooks from "${source.id}": kept the user-authored hook file at ${symlinkPath}. Move or remove that file to bridge hooks for this run.`
        ];
        return manifest;
      }
      manifest.symlinkPath = result.symlinkPath;
      manifest.symlinkTarget = result.targetPath;
      manifest.symlinkReplaced = result.replaced;
      manifest.symlinkCreated = !(
        result.replaced === "none" && preExistingSymlinkTarget === result.targetPath
      );
      try {
        const excludeBlockId = (await appendExcludeBlock({ fs: runtime.fs, cwd: cwd, homeDir: "/", signal: runtime.signal }, runId, [relativeToCwd(cwd, result.symlinkPath)], {
          markerPrefix: hookExcludeMarkerPrefix
        }));
        registerManifest(manifest, { ownershipId: runId, excludeBlockId }, io);
      } catch (error) {
        if ((await io.lstat(result.symlinkPath)).isSymbolicLink()) {
          (await io.unlink(result.symlinkPath));
        }
        throw error;
      }
      return manifest;
    }

    if (!canTransform(source.config, target.config)) {
      throw new Error(
        `Cannot transform hooks from "${source.id}" to "${target.id}". Supported transforms: ${formatSupportedTransformPairs()}.`
      );
    }

    const targetPath = requireTargetPath(target.id, target.config, cwd, homeDir);
    (await assertNoSymbolicLink(path.dirname(targetPath), { root: cwd }, io));
    const priorFile = (await readCodexFile(targetPath, io));
    const sourceHooks = (await readClaudeHooks(cwd, homeDir, { scope: opts?.scope ?? "merged" }, runtime));
    const ownership = acquireOwnershipId(targetPath, runId, io);
    const transformed = transformHooks(sourceHooks.entries, source.id, target.id, { runId: ownership.id });
    const createdParents = (await collectMissingParents(targetPath, io));
    let writeResult;
    try {
      writeResult = (await writeCodexHooks(targetPath, transformed.entries, ownership.id, {
        preserveGenerated: ownership.overlaps
      }, runtime));
    } catch (error) {
      releaseOwnership(targetPath, ownership.id, io);
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
      const excludeBlockId = (await appendExcludeBlock({ fs: runtime.fs, cwd: cwd, homeDir: "/", signal: runtime.signal }, runId, [relativeToCwd(cwd, targetPath)], {
        markerPrefix: hookExcludeMarkerPrefix
      }));
      registerManifest(manifest, { ownershipId: ownership.id, excludeBlockId }, io);
    } catch (error) {
      releaseOwnership(targetPath, ownership.id, io);
      if (priorFile) {
        (await writeCodexFile(targetPath, priorFile, io));
      } else {
        (await io.unlink(targetPath));
      }
      for (const parent of [...createdParents].reverse()) {
        (await removeDirectoryIfEmpty(parent, io));
      }
      throw error;
    }

    return manifest;
  });
}

export async function cleanupBridgedHooks(manifest: BridgeHookManifest, runtime: HookRuntimeOptions = defaultHookRuntime()): Promise<void> {
  return exclusiveHooks(runtime, async () => {
    const io = hookOperations(runtime);
    const state = bridgeStates.get(manifest) ?? (manifest.bridgeId ? providerManifests.get(io.provider)?.get(manifest.bridgeId) : undefined);
    if (state && state.provider !== io.provider) throw new Error("Hook manifest filesystem conflicts with cleanup filesystem");
    if (!state || state.cleaned) {
      return;
    }
    manifest = state.manifest!;
    if (manifest.strategy === "symlink" && manifest.symlinkPath && manifest.symlinkTarget) {
      if (state.symlink ? state.symlink.references === 1 && state.symlink.created : manifest.symlinkCreated !== false) {
        try {
          if (
            (await io.lstat(manifest.symlinkPath)).isSymbolicLink() &&
            (await io.readlink(manifest.symlinkPath)) === manifest.symlinkTarget
          ) {
            (await io.unlink(manifest.symlinkPath));
          }
        } catch (error) {
          if (!hasOwnErrorCode(error, "ENOENT")) {
            throw error;
          }
        }

        for (const parent of [...(state.symlink?.parents ?? manifest.createdParents ?? [])].reverse()) {
          (await removeDirectoryIfEmpty(parent, io));
        }
      }
    }

    if (manifest.strategy === "transform" && manifest.writtenPath) {
      const file = (await readCodexFile(manifest.writtenPath, io));
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
          (await io.unlink(manifest.writtenPath));
        } else {
          (await writeCodexFile(manifest.writtenPath, file, io));
        }
      }

      for (const parent of [...(manifest.createdParents ?? [])].reverse()) {
        (await removeDirectoryIfEmpty(parent, io));
      }
      releaseOwnership(manifest.writtenPath, state?.ownershipId ?? manifest.runId, io);
    }

    (await removeExcludeBlock({ fs: runtime.fs, cwd: manifest.cwd, homeDir: "/", signal: runtime.signal }, state?.excludeBlockId ?? manifest.runId, { markerPrefix: hookExcludeMarkerPrefix }));
    if (state) {
      if (state.symlink && manifest.symlinkPath) {
        state.symlink.references -= 1;
        const symlinks = providerSymlinks.get(io.provider);
        if (state.symlink.references === 0 && symlinks?.get(manifest.symlinkPath) === state.symlink) symlinks.delete(manifest.symlinkPath);
      }
      state.cleaned = true;
      providerManifests.get(io.provider)?.delete(manifest.bridgeId!);
    }
  });
}
