import { createHash, randomUUID } from "node:crypto";
import { posix as path } from "node:path";
import type { FileSystem } from "@poe-code/safe-fs";
import { getAgentConfig, resolveAgentSupport, resolveSkillDir } from "./configs.js";
import { hasOwnErrorCode } from "./error-codes.js";
import { appendExcludeBlockAsync, removeExcludeBlockAsync } from "./git-exclude.js";
import { resolveSkillReferenceAsync, type SkillRuntimeOptions } from "./resolve-skill-reference.js";
import type { BridgeEntry, BridgeManifest, BridgeWarningKind } from "./bridge-active-skills.js";

type OwnedTarget = {
  token: string;
  fingerprint: string;
  sourceFingerprint: string;
  sourcePath: string;
  references: number;
  createdParents: string[];
};
const providers = new WeakMap<
  FileSystem,
  { targets: Map<string, OwnedTarget>; queue: Promise<unknown> }
>();
const manifests = new WeakMap<
  BridgeManifest,
  { fs: FileSystem; cleaned: boolean; blockId?: string }
>();
const ownerFile = ".poe-code-bridge-owner";

// Serialize ownership and excludes within each provider; separate providers never share paths or claims.
async function exclusive<T>(
  fs: FileSystem,
  action: (targets: Map<string, OwnedTarget>) => Promise<T>
): Promise<T> {
  let state = providers.get(fs);
  if (!state) {
    state = { targets: new Map(), queue: Promise.resolve() };
    providers.set(fs, state);
  }
  const result = state.queue.then(() => action(state.targets));
  state.queue = result.catch(() => undefined);
  return result;
}

async function operations(options: SkillRuntimeOptions) {
  const { createNodeFsBridge } = await import("@poe-code/safe-fs");
  const fs = createNodeFsBridge(options.fs, {
    cwd: options.cwd,
    root: "/",
    signal: options.signal
  });
  async function exists(target: string): Promise<boolean> {
    try {
      await fs.lstat(target);
      return true;
    } catch (error) {
      options.signal?.throwIfAborted();
      if (hasOwnErrorCode(error, "ENOENT")) return false;
      throw error;
    }
  }
  async function inspect(target: string): Promise<void> {
    let current = target;
    while (true) {
      try {
        if ((await fs.lstat(current)).isSymbolicLink())
          throw new Error(`Refusing to bridge through symbolic link: ${current}`);
      } catch (error) {
        options.signal?.throwIfAborted();
        if (!hasOwnErrorCode(error, "ENOENT")) throw error;
      }
      const parent = path.dirname(current);
      if (current === parent) break;
      current = parent;
    }
  }
  async function fingerprint(target: string): Promise<string> {
    const hash = createHash("sha256");
    async function visit(current: string, relative: string): Promise<void> {
      const stat = await fs.lstat(current);
      if (stat.isDirectory()) {
        hash.update(`d:${relative}\n`);
        for (const name of (await fs.readdir(current)).sort())
          await visit(path.join(current, name), path.join(relative, name));
      } else if (stat.isFile()) {
        hash.update(`f:${relative}\n`);
        hash.update(await fs.readFile(current));
      } else throw new Error(`Unsupported skill entry or symbolic link: ${current}`);
    }
    await visit(target, ".");
    return hash.digest("hex");
  }
  async function copy(source: string, target: string): Promise<void> {
    await fs.mkdir(target);
    for (const entry of await fs.readdir(source, { withFileTypes: true })) {
      const from = path.join(source, entry.name),
        to = path.join(target, entry.name);
      if (entry.isDirectory()) await copy(from, to);
      else if (entry.isFile()) await fs.copyFile(from, to);
      else throw new Error(`Unsupported skill entry or symbolic link: ${from}`);
    }
  }
  async function remove(target: string, parents: string[]): Promise<void> {
    await inspect(target);
    await fs.rm(target, { recursive: true, force: true });
    for (const parent of [...parents].reverse()) {
      try {
        await fs.rmdir(parent);
      } catch (error) {
        options.signal?.throwIfAborted();
        if (!["ENOENT", "ENOTEMPTY", "EEXIST"].some((code) => hasOwnErrorCode(error, code)))
          throw error;
      }
    }
  }
  async function unchanged(target: string, owned: OwnedTarget): Promise<boolean> {
    if (!(await exists(target))) return false;
    await inspect(target);
    try {
      return (
        (await fs.readFile(path.join(target, ownerFile), "utf8")) === owned.token &&
        (await fingerprint(target)) === owned.fingerprint
      );
    } catch (error) {
      options.signal?.throwIfAborted();
      if (hasOwnErrorCode(error, "ENOENT")) return false;
      throw error;
    }
  }
  return { fs, exists, inspect, fingerprint, copy, remove, unchanged };
}

export async function bridgeActiveSkillsAsync(
  spawnAgentId: string,
  refs: string[],
  runId: string,
  options: SkillRuntimeOptions
): Promise<BridgeManifest> {
  return exclusive(options.fs, async (targets) => {
    const config = getAgentConfig(spawnAgentId),
      support = resolveAgentSupport(spawnAgentId);
    if (!config || support.status !== "supported")
      throw new Error(`Unsupported spawn agent: ${spawnAgentId}`);
    const io = await operations(options);
    const resolutions = await Promise.all(
      refs.map((ref) => resolveSkillReferenceAsync(ref, options))
    );
    for (const resolution of resolutions)
      if (resolution.kind !== "resolved")
        throw new Error(`Failed to resolve skill ${resolution.ref}: ${resolution.kind}`);
    const manifest: BridgeManifest = {
      spawnAgentId,
      cwd: options.cwd,
      runId,
      entries: [],
      warnings: []
    };
    const state = { fs: options.fs, cleaned: false, blockId: undefined as string | undefined };
    manifests.set(manifest, state);
    const claimed = new Set<string>();
    try {
      for (const source of resolutions) {
        if (source.kind !== "resolved") continue;
        const target = path.join(resolveSkillDir(config, "local", options.cwd, options.homeDir, path), source.name);
        const globalTarget = path.join(
          resolveSkillDir(config, "global", options.cwd, options.homeDir, path),
          source.name
        );
        let collision: BridgeWarningKind | undefined;
        if (claimed.has(target)) collision = "intra-batch-collision";
        else if (source.sourceAgentId === support.id) collision = "self-reference";
        await io.inspect(source.sourcePath);
        const sourceFingerprint = await io.fingerprint(source.sourcePath);
        const owned = targets.get(target);
        if (
          !collision &&
          owned &&
          owned.sourcePath === source.sourcePath &&
          owned.sourceFingerprint === sourceFingerprint &&
          (await io.unchanged(target, owned))
        ) {
          owned.references++;
          claimed.add(target);
          manifest.entries.push({
            ref: source.ref,
            sourcePath: source.sourcePath,
            targetPath: target,
            createdParents: []
          });
          continue;
        }
        if (!collision && (await io.exists(target))) collision = "local-collision";
        if (!collision && (await io.exists(globalTarget))) collision = "global-collision";
        if (collision) {
          const conflictingPath = collision === "global-collision" ? globalTarget : target;
          manifest.warnings.push({
            kind: collision,
            ref: source.ref,
            sourcePath: source.sourcePath,
            conflictingPath,
            message: `Skipping ${source.ref}: ${collision} at ${conflictingPath}.`
          });
          continue;
        }
        await io.inspect(target);
        const parents: string[] = [];
        let parent = path.dirname(target);
        while (!(await io.exists(parent))) {
          parents.unshift(parent);
          parent = path.dirname(parent);
        }
        await io.fs.mkdir(path.dirname(target), { recursive: true });
        let created = false;
        try {
          // Exclusive directory creation protects a preexisting target from rollback.
          await io.fs.mkdir(target);
          created = true;
          for (const entry of await io.fs.readdir(source.sourcePath, { withFileTypes: true })) {
            const from = path.join(source.sourcePath, entry.name),
              to = path.join(target, entry.name);
            if (entry.isDirectory()) await io.copy(from, to);
            else if (entry.isFile()) await io.fs.copyFile(from, to);
            else throw new Error(`Unsupported skill entry or symbolic link: ${from}`);
          }
          const token = randomUUID();
          await io.fs.writeFile(path.join(target, ownerFile), token, {
            encoding: "utf8",
            flag: "wx"
          });
          const fingerprint = await io.fingerprint(target);
          targets.set(target, {
            token,
            fingerprint,
            sourceFingerprint,
            sourcePath: source.sourcePath,
            references: 1,
            createdParents: parents
          });
          claimed.add(target);
          manifest.entries.push({
            ref: source.ref,
            sourcePath: source.sourcePath,
            targetPath: target,
            createdParents: parents
          });
        } catch (error) {
          if (created) await (await operations({ ...options, signal: undefined })).remove(target, parents);
          throw error;
        }
      }
      state.blockId = await appendExcludeBlockAsync(
        options,
        runId,
        manifest.entries.map((entry) => path.relative(options.cwd, entry.targetPath))
      );
      if (state.blockId) manifest.excludeBlockId = state.blockId;
      return manifest;
    } catch (error) {
      await release(manifest.entries, targets, await operations({ ...options, signal: undefined }));
      throw error;
    }
  });
}

async function release(
  entries: BridgeEntry[],
  targets: Map<string, OwnedTarget>,
  io: Awaited<ReturnType<typeof operations>>
): Promise<void> {
  for (const entry of [...entries].reverse()) {
    const owned = targets.get(entry.targetPath);
    if (!owned) continue;
    if (owned.references > 1) {
      owned.references--;
      continue;
    }
    if (await io.unchanged(entry.targetPath, owned))
      await io.remove(entry.targetPath, owned.createdParents);
    targets.delete(entry.targetPath);
  }
}

export async function cleanupBridgedSkillsAsync(
  manifest: BridgeManifest,
  options: SkillRuntimeOptions
): Promise<void> {
  const state = manifests.get(manifest);
  if (!state || state.fs !== options.fs)
    throw new Error("Bridge manifest filesystem conflicts with cleanup filesystem");
  await exclusive(options.fs, async (targets) => {
    if (state.cleaned) return;
    if (state.blockId) await removeExcludeBlockAsync(options, state.blockId);
    await release(manifest.entries, targets, await operations(options));
    state.cleaned = true;
  });
}
