import path from "node:path";
import { createBackup } from "../backup-store.js";
import { filesForItem, gistFilenameForBundlePath, gistFilesFromBundle, loadBundleFromGist, verifyBundleHashes } from "../bundle.js";
import { createDefaultGistClient } from "../gist-client.js";
import { hashFiles } from "../hash.js";
import { loadIgnoreMatcher } from "../ignore.js";
import { loadInventory } from "../inventory.js";
import {
  isLocalTargetIgnored,
  removeLocalItem,
  targetPathForItem,
  validateItemForLocalWrite,
  validateTargetForLocalRemove,
  validateTargetForLocalWrite,
  writeItemToLocal
} from "../local-writes.js";
import { normalizeAgent } from "../locations.js";
import { canonicalItemPath, createEmptyManifest, MANIFEST_FILENAME, stableItemId, validateBundlePath, validateManifestItem } from "../manifest.js";
import { recordProfilePush, resolveProfileGist } from "../profile-store.js";
import { assertAgentStashKind, assertAgentStashLocationKind } from "../validation.js";
import type { RemoteBundle } from "../bundle.js";
import type { AgentStashContext, AgentStashItem, BundleFile, CopyMoveOptions, CopyMoveResult, LoadedItem } from "../types.js";

interface SourceItem {
  item: AgentStashItem;
  files: Array<{ path: string; content: string }>;
  remote?: {
    gistId: string;
    bundle: RemoteBundle;
  };
}

export async function copyOrMoveItem(ctx: AgentStashContext, options: CopyMoveOptions): Promise<CopyMoveResult> {
  const plan = await prepareCopyOrMoveItem(ctx, options);
  const { source, target } = plan;
  const itemForTarget = target.item;
  const backup = plan.backupPaths.length > 0
    ? await createBackup(ctx, {
        command: options.operation,
        args: options as unknown as Record<string, unknown>,
        paths: plan.backupPaths
      })
    : undefined;

  if (options.to === "project" || options.to === "global") {
    await writeItemToLocal(ctx, itemForTarget, target.files, itemForTarget.scope, { hookCollision: "insert" });
  } else {
    await writeGistItem(ctx, options, itemForTarget, target.files);
  }

  if (options.operation === "move") {
    if (options.from === "project" || options.from === "global") {
      await removeLocalItem(ctx, source.item);
    } else {
      await removeGistItem(ctx, options, source.item, source.remote);
    }
  }

  return { item: itemForTarget, backupId: backup?.id };
}

export async function validateCopyOrMoveItem(ctx: AgentStashContext, options: CopyMoveOptions): Promise<void> {
  await prepareCopyOrMoveItem(ctx, options);
}

async function prepareCopyOrMoveItem(
  ctx: AgentStashContext,
  options: CopyMoveOptions
): Promise<{ source: SourceItem; target: { item: AgentStashItem; files: BundleFile[] }; backupPaths: string[] }> {
  assertCopyMoveOptions(options);
  if (!options.yes) {
    throw new Error(`${options.operation} writes require --yes in non-interactive mode.`);
  }
  if (options.from === options.to) {
    throw new Error("Copy/move source and target must differ.");
  }
  if (options.from === "archive" || options.to === "archive") {
    throw new Error("Archive copy/move is not implemented.");
  }
  if (options.to === "gist") {
    const resolved = await resolveProfileGist(ctx, options.profile);
    if (!resolved.gistId && !options.profile) {
      throw new Error("A profile with a Gist is required.");
    }
  }

  const source = await loadSourceItem(ctx, options);
  const target = retargetSourceItem(source, options);
  const itemForTarget = target.item;
  if (options.to === "project" || options.to === "global") {
    await assertLocalTargetNotIgnored(ctx, itemForTarget);
    validateItemForLocalWrite(itemForTarget, target.files);
    await validateTargetForLocalWrite(ctx, itemForTarget, itemForTarget.scope);
  }
  if (options.operation === "move" && (options.from === "project" || options.from === "global")) {
    await validateTargetForLocalRemove(ctx, source.item);
  }
  const backupPaths = options.to === "project" || options.to === "global"
    ? [targetPathForItem(ctx, itemForTarget)]
    : [];
  if (options.operation === "move" && (options.from === "project" || options.from === "global")) {
    backupPaths.push(targetPathForItem(ctx, source.item));
  }
  return { source, target, backupPaths };
}

async function assertLocalTargetNotIgnored(ctx: AgentStashContext, item: AgentStashItem): Promise<void> {
  const matcher = await loadIgnoreMatcher(ctx, item.scope);
  if (isLocalTargetIgnored(ctx, matcher, item)) {
    throw new Error(`Target ${item.kind} is ignored: ${item.name}`);
  }
}

function retargetSourceItem(
  source: { item: AgentStashItem; files: BundleFile[] },
  options: CopyMoveOptions
): { item: AgentStashItem; files: BundleFile[] } {
  const scope = targetScopeForLocation(options.to, source.item.scope);
  const targetBase: AgentStashItem = {
    ...source.item,
    scope,
    id: stableItemId({
      scope,
      kind: source.item.kind,
      agentId: source.item.agentId,
      name: source.item.name
    })
  };
  const targetItemPath = canonicalItemPath(targetBase);
  const files = source.files.map((file) => ({
    ...file,
    path: rebaseBundlePath(source.item.path, targetItemPath, file.path)
  }));
  const manifestFiles = source.item.files.map((file) => ({
    ...file,
    path: rebaseBundlePath(source.item.path, targetItemPath, file.path)
  }));
  const item: AgentStashItem = {
    ...targetBase,
    path: targetItemPath,
    files: manifestFiles,
    contentHash: hashFiles(manifestFiles)
  };
  validateManifestItem(item);
  return { item, files };
}

function targetScopeForLocation(location: CopyMoveOptions["to"], fallback: AgentStashItem["scope"]): AgentStashItem["scope"] {
  if (location === "project" || location === "global") {
    return location;
  }
  return fallback;
}

function rebaseBundlePath(sourceItemPath: string, targetItemPath: string, filePath: string): string {
  if (filePath === sourceItemPath) {
    return targetItemPath;
  }
  const relative = path.posix.relative(sourceItemPath, filePath);
  validateBundlePath(relative);
  return `${targetItemPath}/${relative}`;
}

function assertCopyMoveOptions(options: CopyMoveOptions): void {
  if (options.operation !== "copy" && options.operation !== "move") {
    throw new Error(`Invalid copy/move operation: ${String(options.operation)}`);
  }
  assertAgentStashLocationKind(options.from, "copy/move source");
  assertAgentStashLocationKind(options.to, "copy/move target");
  assertAgentStashKind(options.kind, "copy/move kind");
}

async function loadSourceItem(
  ctx: AgentStashContext,
  options: CopyMoveOptions
): Promise<SourceItem> {
  if (options.from === "project" || options.from === "global") {
    const items = await loadInventory(ctx, {
      scope: options.from,
      agent: options.agent,
      kind: options.kind,
      skills: options.kind === "skill" ? [options.name] : undefined,
      hooks: options.kind === "hook" ? [options.name] : undefined
    });
    const item = items.find((candidate) => candidate.name === options.name);
    if (!item) {
      throw new Error(`Local item not found: ${options.name}`);
    }
    return { item: stripLoaded(item), files: item.bundleFiles };
  }

  const agentId = normalizeAgent(options.agent);
  const resolved = await resolveProfileGist(ctx, options.profile);
  if (!resolved.gistId) {
    throw new Error("A profile with a Gist is required.");
  }
  const client = ctx.gistClient ?? (await createDefaultGistClient());
  const bundle = loadBundleFromGist(await client.read(resolved.gistId));
  verifyBundleHashes(bundle);
  const matches = bundle.manifest.items.filter(
    (candidate) =>
      candidate.kind === options.kind &&
      candidate.agentId === agentId &&
      candidate.name === options.name &&
      (options.sourceId === undefined || candidate.id === options.sourceId)
  );
  if (matches.length > 1) {
    throw new Error(`Remote item name is ambiguous: ${options.name}`);
  }
  const item = matches[0];
  if (!item) {
    throw new Error(`Remote item not found: ${options.name}`);
  }
  return { item, files: filesForItem(bundle, item.id), remote: { gistId: resolved.gistId, bundle } };
}

function stripLoaded(item: LoadedItem): AgentStashItem {
  const { bundleFiles: ignoredBundleFiles, targetPath: ignoredTargetPath, ...manifestItem } = item;
  void ignoredBundleFiles;
  void ignoredTargetPath;
  return manifestItem;
}

async function removeGistItem(
  ctx: AgentStashContext,
  options: CopyMoveOptions,
  item: AgentStashItem,
  source?: SourceItem["remote"]
): Promise<void> {
  const resolved = await resolveProfileGist(ctx, options.profile);
  const gistId = source?.gistId ?? resolved.gistId;
  if (!gistId) {
    throw new Error("A profile with a Gist is required.");
  }
  const client = ctx.gistClient ?? (await createDefaultGistClient());
  const bundle = source?.bundle ?? loadBundleFromGist(await client.read(gistId));
  if (!source) {
    verifyBundleHashes(bundle);
  }
  const nextFiles = new Map(bundle.files);
  const deletedFiles = new Set<string>();
  for (const file of item.files) {
    nextFiles.delete(file.path);
    deletedFiles.add(file.path);
  }
  bundle.manifest.updatedAt = (ctx.now?.() ?? new Date()).toISOString();
  bundle.manifest.items = bundle.manifest.items.filter((candidate) => candidate.id !== item.id);
  const writeInput = gistFilesFromBundle(
    bundle.manifest,
    [...nextFiles.entries()].map(([filePath, content]) => ({ path: filePath, content }))
  );
  await client.update(gistId, {
    files: {
      ...writeInput,
      ...Object.fromEntries([...deletedFiles].map((filePath) => [gistFilenameForBundlePath(filePath), null]))
    }
  });
}

async function writeGistItem(
  ctx: AgentStashContext,
  options: CopyMoveOptions,
  item: AgentStashItem,
  files: BundleFile[]
): Promise<void> {
  const resolved = await resolveProfileGist(ctx, options.profile);
  if (!resolved.gistId && !options.profile) {
    throw new Error("A profile with a Gist is required.");
  }
  const client = ctx.gistClient ?? (await createDefaultGistClient());
  const now = ctx.now?.() ?? new Date();
  const gist = resolved.gistId === undefined ? undefined : await client.read(resolved.gistId);
  const hasExistingManifest = gist?.files[MANIFEST_FILENAME] !== undefined;
  const bundle = hasExistingManifest
    ? loadBundleFromGist(gist)
    : { manifest: createEmptyManifest(now, options.profile), files: new Map<string, string>() };
  verifyBundleHashes(bundle);
  const previous = bundle.manifest.items.find((candidate) => candidate.id === item.id);
  const nextFiles = new Map(bundle.files);
  const deletedFiles = new Set<string>();
  if (previous) {
    for (const file of previous.files) {
      nextFiles.delete(file.path);
      deletedFiles.add(file.path);
    }
  }
  for (const file of files) {
    nextFiles.set(file.path, file.content);
    deletedFiles.delete(file.path);
  }
  bundle.manifest.updatedAt = now.toISOString();
  bundle.manifest.items = [
    ...bundle.manifest.items.filter((candidate) => candidate.id !== item.id),
    item
  ].sort((left, right) => left.id.localeCompare(right.id));
  const writeInput = gistFilesFromBundle(
    bundle.manifest,
    [...nextFiles.entries()].map(([filePath, content]) => ({ path: filePath, content }))
  );
  const input = {
    files: {
      ...writeInput,
      ...Object.fromEntries([...deletedFiles].map((filePath) => [gistFilenameForBundlePath(filePath), null]))
    }
  };
  if (gist && !hasExistingManifest) {
    for (const filename of Object.keys(gist.files)) {
      if (!Object.hasOwn(input.files, filename)) {
        input.files[filename] = null;
      }
    }
  }
  const record = resolved.gistId === undefined
    ? await client.createSecret({ description: "agent-stash portable agent config", ...input })
    : await client.update(resolved.gistId, input);
  await recordProfilePush(ctx, options.profile, record.id, record.htmlUrl, now.toISOString());
}
