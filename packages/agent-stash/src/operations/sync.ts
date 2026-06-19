import { loadBundleFromGist, verifyBundleHashes } from "../bundle.js";
import { createBackup } from "../backup-store.js";
import { createDefaultGistClient } from "../gist-client.js";
import { loadInventory } from "../inventory.js";
import {
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
import { assertAgentStashScope, assertConflictPolicy, assertSelectedItemsFound } from "../validation.js";
import type {
  AgentStashContext,
  AgentStashItem,
  BundleFile,
  ConflictResolution,
  GistWriteInput,
  LoadedItem,
  SyncOptions,
  SyncResult
} from "../types.js";

export async function syncBundle(ctx: AgentStashContext, options: SyncOptions): Promise<SyncResult> {
  assertAgentStashScope(options.scope);
  assertConflictPolicy(options.onConflict);
  if (!options.yes) {
    throw new Error("Sync writes require --yes in non-interactive mode.");
  }
  if (options.onConflict === "ask" && !options.resolveConflict) {
    throw new Error("--on-conflict ask requires an interactive conflict resolver.");
  }
  const agentId = normalizeAgent(options.agent);
  const resolved = await resolveProfileGist(ctx, options.profile, options.gist);
  const usesProfileTarget = options.profile !== undefined && options.gist === undefined;
  if (!resolved.gistId) {
    throw new Error("A profile with a Gist or --gist is required.");
  }
  const client = ctx.gistClient ?? (await createDefaultGistClient());
  const local = await loadSyncInventory(ctx, options);
  const localById = new Map(local.map((item) => [item.id, item]));
  const gist = await client.read(resolved.gistId);
  const remote = loadBundleFromGist(gist);
  verifyBundleHashes(remote);
  const remoteItems = remote.manifest.items.filter((item) => {
    if (item.scope !== options.scope || item.agentId !== agentId) {
      return false;
    }
    if (item.kind === "skill" && options.skills !== undefined) {
      return options.skills.includes(item.name);
    }
    if (item.kind === "hook" && options.hooks !== undefined) {
      return options.hooks.includes(item.name);
    }
    return options.skills === undefined && options.hooks === undefined;
  });
  assertSelectedItemsFound([...local, ...remoteItems], options);
  const remoteById = new Map(remoteItems.map((item) => [item.id, item]));
  const base = usesProfileTarget ? await readBaselineManifest(ctx, options.profile!) : null;
  const baseById = new Map((base?.items ?? []).map((item) => [item.id, item]));
  const ids = new Set([...localById.keys(), ...remoteById.keys(), ...baseById.keys()]);
  const result: SyncResult = { uploaded: [], downloaded: [], deletedLocal: [], deletedRemote: [], unchanged: [], conflicts: [] };
  const nextRemoteItems = new Map(remote.manifest.items.map((item) => [item.id, item]));
  const nextFiles = new Map<string, string>(remote.files);
  const actions: Array<{
    action: Action;
    localItem?: LoadedItem;
    remoteItem?: AgentStashItem;
    baseItem?: AgentStashItem;
  }> = [];

  for (const id of ids) {
    const localItem = localById.get(id);
    const remoteItem = remoteById.get(id);
    const baseItem = baseById.get(id);
    const initialAction = classify(localItem, remoteItem, baseItem, options.onConflict);
    const action = initialAction === "conflict" && options.onConflict === "ask"
      ? classify(localItem, remoteItem, baseItem, await resolveAskedConflict(options, localItem, remoteItem, baseItem))
      : initialAction;
    actions.push({ action, localItem, remoteItem, baseItem });
    if (action === "unchanged" && (localItem ?? remoteItem)) {
      result.unchanged.push(localItem ?? remoteItem!);
    } else if (action === "conflict" && (localItem ?? remoteItem)) {
      result.conflicts.push(localItem ?? remoteItem!);
    } else if (action === "conflict" && baseItem) {
      result.conflicts.push(baseItem);
    }
  }

  if (result.conflicts.length > 0 && (options.onConflict === "fail" || options.onConflict === "ask")) {
    return result;
  }

  for (const { action, remoteItem } of actions) {
    if (action === "download" && remoteItem) {
      validateItemForLocalWrite(
        remoteItem,
        remoteItem.files.map((file) => ({ path: file.path, content: requiredFile(nextFiles, file.path) }))
      );
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

  const remoteDeletes = new Set<string>();

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

  if (result.uploaded.length > 0 || result.deletedRemote.length > 0) {
    const now = ctx.now?.() ?? new Date();
    const manifest = {
      ...remote.manifest,
      profile: usesProfileTarget ? options.profile! : remote.manifest.profile,
      updatedAt: now.toISOString(),
      items: [...nextRemoteItems.values()].sort((left, right) => left.id.localeCompare(right.id))
    };
    const files: BundleFile[] = [...nextFiles.entries()].map(([filePath, content]) => ({ path: filePath, content }));
    const writeInput: GistWriteInput = { files: gistFilesFromBundle(manifest, files) };
    for (const filePath of remoteDeletes) {
      writeInput.files[gistFilenameForBundlePath(filePath)] = null;
    }
    await client.update(resolved.gistId, writeInput);
    if (usesProfileTarget) {
      await writeBaselineManifest(ctx, options.profile!, manifest);
    }
  } else if (usesProfileTarget) {
    await writeBaselineManifest(ctx, options.profile!, remote.manifest);
  }

  return result;
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

function requiredFile(files: Map<string, string>, filePath: string): string {
  const content = files.get(filePath);
  if (content === undefined) {
    throw new Error(`Remote bundle is missing ${filePath}`);
  }
  return content;
}
