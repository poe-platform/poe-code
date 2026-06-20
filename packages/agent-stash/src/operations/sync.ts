import { loadBundleFromGist, verifyBundleHashes } from "../bundle.js";
import { createBackup } from "../backup-store.js";
import { createDefaultGistClient } from "../gist-client.js";
import { hookEventFromFragmentContent } from "../hook-items.js";
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
import { readBaselineManifest, resolveProfileGist, writeBaselineManifest } from "../profile-store.js";
import { gistFilenameForBundlePath, gistFilesFromBundle } from "../bundle.js";
import { createEmptyManifest, MANIFEST_FILENAME } from "../manifest.js";
import { traceAgentStash, traceAgentStashError, traceGistWriteInput, traceItems } from "../trace.js";
import { uploadBundle } from "./upload.js";
import { assertAgentStashScope, assertConflictPolicy, assertSelectedItemsFound, selectedHookMatchesName } from "../validation.js";
import type {
  AgentStashContext,
  AgentStashItem,
  AgentStashManifest,
  BundleFile,
  GistClient,
  GistRecord,
  ConflictResolution,
  GistWriteInput,
  LoadedItem,
  SyncOptions,
  SyncResult
} from "../types.js";

const SYNC_MANIFEST_READ_ATTEMPTS = 6;
const SYNC_MANIFEST_RETRY_DELAY_MS = 500;

export async function syncBundle(ctx: AgentStashContext, options: SyncOptions): Promise<SyncResult> {
  assertAgentStashScope(options.scope);
  assertConflictPolicy(options.onConflict);
  if (!options.yes) {
    throw new Error("Sync writes require --yes in non-interactive mode.");
  }
  if (options.onConflict === "ask" && !options.resolveConflict) {
    throw new Error("--on-conflict ask requires an interactive conflict resolver.");
  }
  await traceAgentStash(ctx, "sync.start", {
    profile: options.profile,
    gist: options.gist,
    scope: options.scope,
    agent: options.agent,
    skills: options.skills,
    hooks: options.hooks,
    onConflict: options.onConflict
  });
  try {
  const agentId = normalizeAgent(options.agent);
  const resolved = await resolveProfileGist(ctx, options.profile, options.gist);
  const usesProfileTarget = options.profile !== undefined && options.gist === undefined;
  if (!resolved.gistId) {
    if (!usesProfileTarget) {
      throw new Error("A profile with a Gist or --gist is required.");
    }
    const initialUpload = await uploadBundle(ctx, {
      profile: options.profile,
      gist: options.gist,
      scope: options.scope,
      agent: options.agent,
      skills: options.skills,
      hooks: options.hooks,
      yes: options.yes
    });
    if (usesProfileTarget) {
      await writeBaselineManifest(ctx, options.profile!, initialUpload.manifest);
    }
    await traceAgentStash(ctx, "sync.initialUpload", { uploaded: traceItems(initialUpload.uploaded) });
    return {
      uploaded: initialUpload.uploaded,
      downloaded: [],
      deletedLocal: [],
      deletedRemote: [],
      unchanged: [],
      conflicts: []
    };
  }
  const client = ctx.gistClient ?? (await createDefaultGistClient());
  const local = await loadSyncInventory(ctx, options);
  await traceAgentStash(ctx, "sync.local.inventory", { items: traceItems(local) });
  const localHookEvents = hookEventsForLoadedItems(local);
  const localById = new Map(local.map((item) => [item.id, item]));
  const gist = await readSyncGistRecord(client, resolved.gistId, shouldRetryRemoteManifestRead(local, options));
  const hasExistingManifest = gist.files[MANIFEST_FILENAME] !== undefined;
  const remote = hasExistingManifest
    ? loadBundleFromGist(gist)
    : { manifest: createEmptyManifest(ctx.now?.() ?? new Date(), usesProfileTarget ? options.profile : undefined), files: new Map<string, string>() };
  verifyBundleHashes(remote);
  const remoteItems = await filterRemoteItemsForLocalIgnores(ctx, options.scope, remote.manifest.items.filter((item) => {
    if (item.scope !== options.scope || item.agentId !== agentId) {
      return false;
    }
    if (item.kind === "skill" && options.skills !== undefined) {
      return options.skills.includes(item.name);
    }
    if (item.kind === "hook" && options.hooks !== undefined) {
      return options.hooks.some((hook) => selectedHookMatchesName(item.name, hook));
    }
    return options.skills === undefined && options.hooks === undefined;
  }).filter((item) => !(item.kind === "hook" && localHookEvents.has(item.name))));
  await traceAgentStash(ctx, "sync.remote.selected", { gistId: resolved.gistId, items: traceItems(remoteItems) });
  assertSelectedItemsFound([...local, ...remoteItems], options);
  const remoteById = new Map(remoteItems.map((item) => [item.id, item]));
  const base = usesProfileTarget ? await readBaselineManifest(ctx, options.profile!) : null;
  const baseById = new Map((base?.items ?? []).map((item) => [item.id, item]));
  const selectedBaselineIds = selectedIdsForBaseline(base, localById, remoteById, options, agentId);
  const ids = new Set([...localById.keys(), ...remoteById.keys(), ...baseById.keys()]);
  const result: SyncResult = { uploaded: [], downloaded: [], deletedLocal: [], deletedRemote: [], unchanged: [], conflicts: [] };
  const nextRemoteItems = new Map(remote.manifest.items.map((item) => [item.id, item]));
  const nextFiles = new Map<string, string>(remote.files);
  const legacyRemoteDeletes = remote.manifest.items.filter((item) => item.kind === "hook" && localHookEvents.has(item.name));
  if (legacyRemoteDeletes.length > 0) {
    await traceAgentStash(ctx, "sync.legacyHookChunksRemoved", { items: traceItems(legacyRemoteDeletes) });
  }
  for (const item of legacyRemoteDeletes) {
    nextRemoteItems.delete(item.id);
    for (const file of item.files) {
      nextFiles.delete(file.path);
    }
  }
  const actions: Array<{
    action: Action;
    initialAction: Action;
    conflictResolution?: ConflictResolution;
    localItem?: LoadedItem;
    remoteItem?: AgentStashItem;
    baseItem?: AgentStashItem;
  }> = [];

  for (const id of ids) {
    const localItem = localById.get(id);
    const remoteItem = remoteById.get(id);
    const baseItem = baseById.get(id);
    const initialAction = classify(localItem, remoteItem, baseItem, options.onConflict);
    const conflictResolution = initialAction === "conflict" && options.onConflict === "ask"
      ? await resolveAskedConflict(options, localItem, remoteItem, baseItem)
      : undefined;
    const action = conflictResolution === undefined
      ? initialAction
      : classify(localItem, remoteItem, baseItem, conflictResolution);
    actions.push({ action, initialAction, conflictResolution, localItem, remoteItem, baseItem });
    if (action === "unchanged" && (localItem ?? remoteItem)) {
      result.unchanged.push(localItem ?? remoteItem!);
    } else if (action === "conflict" && (localItem ?? remoteItem)) {
      result.conflicts.push(localItem ?? remoteItem!);
    } else if (action === "conflict" && baseItem) {
      result.conflicts.push(baseItem);
    }
  }
  await traceAgentStash(ctx, "sync.actions", {
    actions: actions.map(({ action, initialAction, conflictResolution, localItem, remoteItem, baseItem }) => ({
      action,
      initialAction,
      conflictResolution,
      localId: localItem?.id,
      remoteId: remoteItem?.id,
      baseId: baseItem?.id,
      ...traceActionItem("local", localItem),
      ...traceActionItem("remote", remoteItem),
      ...traceActionItem("base", baseItem)
    }))
  });

  if (result.conflicts.length > 0 && (options.onConflict === "fail" || options.onConflict === "ask")) {
    await traceAgentStash(ctx, "sync.finish", { conflicts: traceItems(result.conflicts) });
    return result;
  }

  for (const { action, localItem, remoteItem } of actions) {
    if (action === "download" && remoteItem) {
      validateItemForLocalWrite(
        remoteItem,
        remoteItem.files.map((file) => ({ path: file.path, content: requiredFile(nextFiles, file.path) }))
      );
      if (localItem) {
        await validateTargetForLocalRemove(ctx, localItem);
      }
      await validateTargetForLocalWrite(ctx, remoteItem);
    }
  }
  for (const { action, localItem } of actions) {
    if (action === "delete-local" && localItem) {
      await validateTargetForLocalRemove(ctx, localItem);
    }
  }

  const downloadTargets = actions
    .filter(({ action, localItem, remoteItem }) => (action === "download" && remoteItem !== undefined) || (action === "delete-local" && localItem !== undefined))
    .map(({ action, localItem, remoteItem }) => targetPathForItem(ctx, action === "delete-local" ? localItem! : remoteItem!));
  if (downloadTargets.length > 0) {
    const backup = await createBackup(ctx, {
      command: "sync",
      args: options as unknown as Record<string, unknown>,
      paths: downloadTargets
    });
    result.backupId = backup.id;
  }

  const remoteDeletes = new Set<string>(legacyRemoteDeletes.flatMap((item) => item.files.map((file) => file.path)));

  for (const { action, localItem, remoteItem } of actions) {
    if (action === "upload" && localItem) {
      result.uploaded.push(localItem);
      if (remoteItem) {
        for (const file of remoteItem.files) {
          nextFiles.delete(file.path);
          remoteDeletes.add(file.path);
        }
      }
      nextRemoteItems.set(localItem.id, stripLoaded(localItem));
      for (const file of localItem.bundleFiles) {
        nextFiles.set(file.path, file.content);
        remoteDeletes.delete(file.path);
      }
    } else if (action === "download" && remoteItem) {
      const files = remoteItem.files.map((file) => ({ path: file.path, content: requiredFile(nextFiles, file.path) }));
      if (localItem) {
        await removeLocalItem(ctx, localItem);
      }
      await writeItemToLocal(ctx, remoteItem, files);
      result.downloaded.push(remoteItem);
    } else if (action === "delete-local" && localItem) {
      await removeLocalItem(ctx, localItem);
      result.deletedLocal.push(localItem);
    } else if (action === "delete-remote" && remoteItem) {
      nextRemoteItems.delete(remoteItem.id);
      for (const file of remoteItem.files) {
        nextFiles.delete(file.path);
        remoteDeletes.add(file.path);
      }
      result.deletedRemote.push(remoteItem);
    }
  }

  if (result.uploaded.length > 0 || result.deletedRemote.length > 0 || legacyRemoteDeletes.length > 0) {
    const now = ctx.now?.() ?? new Date();
    const manifest = {
      ...remote.manifest,
      profile: usesProfileTarget ? options.profile! : remote.manifest.profile,
      updatedAt: now.toISOString(),
      items: [...nextRemoteItems.values()].sort((left, right) => left.id.localeCompare(right.id))
    };
    const files: BundleFile[] = hasExistingManifest
      ? actions.flatMap(({ action, localItem }) => action === "upload" && localItem ? localItem.bundleFiles : [])
      : [...nextFiles.entries()].map(([filePath, content]) => ({ path: filePath, content }));
    const writeInput: GistWriteInput = { files: gistFilesFromBundle(manifest, files) };
    if (!hasExistingManifest) {
      for (const filename of Object.keys(gist.files)) {
        if (!Object.hasOwn(writeInput.files, filename)) {
          writeInput.files[filename] = null;
        }
      }
    }
    for (const filePath of remoteDeletes) {
      writeInput.files[gistFilenameForBundlePath(filePath)] = null;
    }
    await traceAgentStash(ctx, "sync.remote.update", {
      gistId: resolved.gistId,
      ...traceGistWriteInput(writeInput)
    });
    await client.update(resolved.gistId, writeInput);
    if (usesProfileTarget) {
      await writeBaselineManifest(ctx, options.profile!, mergeBaselineManifest(base, manifest, selectedBaselineIds));
    }
  } else if (usesProfileTarget) {
    await writeBaselineManifest(ctx, options.profile!, mergeBaselineManifest(base, remote.manifest, selectedBaselineIds));
  }

  await traceAgentStash(ctx, "sync.finish", {
    uploaded: traceItems(result.uploaded),
    downloaded: traceItems(result.downloaded),
    deletedLocal: traceItems(result.deletedLocal),
    deletedRemote: traceItems(result.deletedRemote),
    unchanged: traceItems(result.unchanged),
    conflicts: traceItems(result.conflicts),
    backupId: result.backupId
  });
  return result;
  } catch (error) {
    await traceAgentStashError(ctx, "sync.error", error);
    throw error;
  }
}

function shouldRetryRemoteManifestRead(local: LoadedItem[], options: SyncOptions): boolean {
  if (options.skills === undefined && options.hooks === undefined) {
    return local.length === 0;
  }
  for (const skill of options.skills ?? []) {
    if (!local.some((item) => item.kind === "skill" && item.name === skill)) {
      return true;
    }
  }
  for (const hook of options.hooks ?? []) {
    if (!local.some((item) => item.kind === "hook" && selectedHookMatchesName(item.name, hook))) {
      return true;
    }
  }
  return false;
}

async function readSyncGistRecord(client: GistClient, gistId: string, retryNonManifest: boolean): Promise<GistRecord> {
  let latest = await client.read(gistId);
  for (let attempt = 1; retryNonManifest && attempt < SYNC_MANIFEST_READ_ATTEMPTS && isNonEmptyGistWithoutManifest(latest); attempt += 1) {
    if (attempt > 1) {
      await sleep(SYNC_MANIFEST_RETRY_DELAY_MS);
    }
    latest = await client.read(gistId);
  }
  return latest;
}

function isNonEmptyGistWithoutManifest(gist: GistRecord): boolean {
  return gist.files[MANIFEST_FILENAME] === undefined && Object.keys(gist.files).length > 0;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function selectedIdsForBaseline(
  base: AgentStashManifest | null,
  localById: Map<string, LoadedItem>,
  remoteById: Map<string, AgentStashItem>,
  options: SyncOptions,
  agentId: string
): Set<string> {
  const selectedIds = new Set([...localById.keys(), ...remoteById.keys()]);
  if (options.skills !== undefined || options.hooks !== undefined) {
    return selectedIds;
  }
  for (const item of base?.items ?? []) {
    if (item.scope === options.scope && item.agentId === agentId) {
      selectedIds.add(item.id);
    }
  }
  return selectedIds;
}

function hookEventsForLoadedItems(items: LoadedItem[]): Set<string> {
  const events = new Set<string>();
  for (const item of items) {
    if (item.kind !== "hook") {
      continue;
    }
    const event = hookEventFromFragmentContent(item.bundleFiles[0]?.content ?? "");
    if (event !== undefined && event !== item.name) {
      events.add(event);
    }
  }
  return events;
}

function mergeBaselineManifest(
  base: AgentStashManifest | null,
  remoteManifest: AgentStashManifest,
  selectedIds: Set<string>
): AgentStashManifest {
  const nextById = new Map((base?.items ?? []).map((item) => [item.id, item]));
  for (const id of selectedIds) {
    nextById.delete(id);
  }
  for (const item of remoteManifest.items) {
    if (selectedIds.has(item.id)) {
      nextById.set(item.id, item);
    }
  }
  return {
    ...remoteManifest,
    items: [...nextById.values()].sort((left, right) => left.id.localeCompare(right.id))
  };
}

async function loadSyncInventory(ctx: AgentStashContext, options: SyncOptions): Promise<LoadedItem[]> {
  if (options.skills === undefined && options.hooks === undefined) {
    return loadInventory(ctx, options);
  }
  const [skills, hooks] = await Promise.all([
    options.skills === undefined
      ? Promise.resolve([])
      : loadInventory(ctx, { ...options, kind: "skill", skills: options.skills }),
    options.hooks === undefined
      ? Promise.resolve([])
      : loadInventory(ctx, { ...options, kind: "hook", hooks: options.hooks })
  ]);
  return [...skills, ...hooks].sort((left, right) => left.id.localeCompare(right.id));
}

async function filterRemoteItemsForLocalIgnores(
  ctx: AgentStashContext,
  scope: SyncOptions["scope"],
  items: AgentStashItem[]
): Promise<AgentStashItem[]> {
  const matcher = await loadIgnoreMatcher(ctx, scope);
  return items.filter((item) => !isLocalTargetIgnored(ctx, matcher, item, scope));
}

type Action = "unchanged" | "upload" | "download" | "delete-local" | "delete-remote" | "conflict";

async function resolveAskedConflict(
  options: SyncOptions,
  localItem: LoadedItem | undefined,
  remoteItem: AgentStashItem | undefined,
  baseItem: AgentStashItem | undefined
): Promise<ConflictResolution> {
  if (!options.resolveConflict) {
    throw new Error("--on-conflict ask requires an interactive conflict resolver.");
  }
  const resolution = await options.resolveConflict({
    item: localItem ?? remoteItem ?? baseItem!,
    local: localItem,
    remote: remoteItem,
    base: baseItem
  });
  assertConflictResolution(resolution);
  return resolution;
}

function assertConflictResolution(value: ConflictResolution): void {
  if (value !== "local" && value !== "remote" && value !== "newer" && value !== "fail") {
    throw new Error(`Invalid conflict resolution: ${String(value)}. Expected local, remote, newer, or fail.`);
  }
}

function classify(
  local: AgentStashItem | undefined,
  remote: AgentStashItem | undefined,
  base: AgentStashItem | undefined,
  policy: SyncOptions["onConflict"]
): Action {
  if (local && remote && local.contentHash === remote.contentHash) {
    return "unchanged";
  }
  if (local && !remote && !base) {
    return "upload";
  }
  if (!local && remote && !base) {
    return "download";
  }
  if (local && !remote && base) {
    if (policy === "ask" && local.contentHash === base.contentHash) {
      return "delete-local";
    }
    if (policy === "local") {
      return "upload";
    }
    if (policy === "remote") {
      return "delete-local";
    }
    if (policy === "newer") {
      return Date.parse(local.updatedAt) > Date.parse(base.updatedAt) ? "upload" : "delete-local";
    }
    return "conflict";
  }
  if (!local && remote && base) {
    if (policy === "ask" && remote.contentHash === base.contentHash) {
      return "delete-remote";
    }
    if (policy === "local") {
      return "delete-remote";
    }
    if (policy === "remote") {
      return "download";
    }
    if (policy === "newer") {
      return Date.parse(remote.updatedAt) > Date.parse(base.updatedAt) ? "download" : "delete-remote";
    }
    return "conflict";
  }
  if (!local && !remote) {
    return "unchanged";
  }
  if (local && remote && base && local.contentHash === base.contentHash) {
    return "download";
  }
  if (local && remote && base && remote.contentHash === base.contentHash) {
    return "upload";
  }
  if (policy === "local") {
    return local ? "upload" : "download";
  }
  if (policy === "remote") {
    return remote ? "download" : "upload";
  }
  if (policy === "newer" && local && remote) {
    return Date.parse(local.updatedAt) >= Date.parse(remote.updatedAt) ? "upload" : "download";
  }
  return "conflict";
}

function stripLoaded(item: LoadedItem): AgentStashItem {
  const { bundleFiles: ignoredBundleFiles, targetPath: ignoredTargetPath, ...manifestItem } = item;
  void ignoredBundleFiles;
  void ignoredTargetPath;
  return manifestItem;
}

function traceActionItem(
  prefix: "local" | "remote" | "base",
  item: AgentStashItem | undefined
): Record<string, string | number> {
  if (!item) {
    return {};
  }
  return {
    [`${prefix}Hash`]: item.contentHash,
    [`${prefix}UpdatedAt`]: item.updatedAt,
    [`${prefix}Name`]: item.name,
    [`${prefix}Kind`]: item.kind,
    [`${prefix}FileCount`]: item.files.length,
    [`${prefix}Size`]: item.files.reduce((total, file) => total + file.size, 0)
  };
}

function requiredFile(files: Map<string, string>, filePath: string): string {
  const content = files.get(filePath);
  if (content === undefined) {
    throw new Error(`Remote bundle is missing ${filePath}`);
  }
  return content;
}
