import { createDefaultGistClient } from "../gist-client.js";
import { createEmptyManifest, parseManifest } from "../manifest.js";
import { hookEventFromFragmentContent } from "../hook-items.js";
import { loadInventory } from "../inventory.js";
import { gistFilenameForBundlePath, gistFilesFromBundle, loadBundleFromGist, verifyBundleHashes } from "../bundle.js";
import { recordProfilePush, resolveProfileGist } from "../profile-store.js";
import { MANIFEST_FILENAME } from "../manifest.js";
import { traceAgentStash, traceItems } from "../trace.js";
import { assertAgentStashScope, assertSelectedItemsFound } from "../validation.js";
import type { AgentStashContext, AgentStashManifest, BundleFile, GistClient, GistWriteInput, UploadOptions, UploadResult } from "../types.js";

export async function uploadBundle(ctx: AgentStashContext, options: UploadOptions): Promise<UploadResult> {
  assertAgentStashScope(options.scope);
  if (!options.yes) {
    throw new Error("Upload writes require --yes in non-interactive mode.");
  }
  await traceAgentStash(ctx, "upload.start", {
    profile: options.profile,
    gist: options.gist,
    scope: options.scope,
    agent: options.agent,
    skills: options.skills,
    hooks: options.hooks
  });
  const now = ctx.now?.() ?? new Date();
  const resolved = await resolveProfileGist(ctx, options.profile, options.gist);
  const usesProfileTarget = options.profile !== undefined && options.gist === undefined;
  const profileName = usesProfileTarget ? options.profile : undefined;
  const items = await loadUploadInventory(ctx, options);
  assertSelectedItemsFound(items, options);
  const selectedItems = items.map(({ bundleFiles: _bundleFiles, targetPath: _targetPath, ...item }) => item);
  if (!resolved.gistId && selectedItems.length === 0) {
    throw new Error("No upload items selected.");
  }
  await traceAgentStash(ctx, "upload.inventory", { items: traceItems(selectedItems) });
  const client = ctx.gistClient ?? (await createDefaultGistClient());
  const writeInput = resolved.gistId
    ? await createUpdateWriteInput(ctx, client, resolved.gistId, selectedItems, items.flatMap((item) => item.bundleFiles), profileName, options.hooks)
    : createCreateWriteInput(now, profileName, selectedItems, items.flatMap((item) => item.bundleFiles));
  await traceAgentStash(ctx, resolved.gistId ? "upload.remote.update" : "upload.remote.create", {
    gistId: resolved.gistId,
    fileWrites: Object.values(writeInput.files).filter((file) => file !== null).length,
    fileDeletes: Object.values(writeInput.files).filter((file) => file === null).length
  });
  const record = resolved.gistId
    ? await client.update(resolved.gistId, writeInput)
    : await client.createSecret(writeInput);
  await recordProfilePush(ctx, profileName, record.id, record.htmlUrl, now.toISOString());
  const manifestContent = writeInput.files[MANIFEST_FILENAME]?.content;
  if (manifestContent === undefined) {
    throw new Error(`Upload write input missing ${MANIFEST_FILENAME}.`);
  }
  const uploadedManifest = parseManifest(manifestContent);
  await traceAgentStash(ctx, "upload.finish", { gistId: record.id, uploaded: traceItems(selectedItems) });
  return { gistId: record.id, manifest: uploadedManifest, uploaded: selectedItems };
}

function createCreateWriteInput(
  now: Date,
  profile: string | undefined,
  items: AgentStashManifest["items"],
  files: BundleFile[]
): GistWriteInput {
  const manifest = createEmptyManifest(now, profile);
  manifest.items = items;
  return {
    description: "agent-stash portable agent config",
    files: gistFilesFromBundle(manifest, files)
  };
}

async function createUpdateWriteInput(
  ctx: AgentStashContext,
  client: GistClient,
  gistId: string,
  items: AgentStashManifest["items"],
  files: BundleFile[],
  profile: string | undefined,
  selectedHooks: string[] | undefined
): Promise<GistWriteInput> {
  const now = ctx.now?.() ?? new Date();
  const record = await client.read(gistId);
  const existing = record.files[MANIFEST_FILENAME]
    ? loadBundleFromGist(record)
    : { manifest: createEmptyManifest(now, profile), files: new Map<string, string>() };
  verifyBundleHashes(existing);
  const itemIds = new Set(items.map((item) => item.id));
  const uploadedHookEvents = hookEventsForItems(items, files);
  const replacedSplitHookEvents = hookEventsForEventLevelUpload(items, files, selectedHooks);
  const legacyHookItems = existing.manifest.items.filter((item) => item.kind === "hook" && uploadedHookEvents.has(item.name));
  if (legacyHookItems.length > 0) {
    await traceAgentStash(ctx, "upload.legacyHookChunksRemoved", { items: traceItems(legacyHookItems) });
  }
  const staleSplitHookItems = existing.manifest.items.filter((item) => !itemIds.has(item.id) && isStaleSplitHookItem(item, replacedSplitHookEvents, existing.files));
  if (staleSplitHookItems.length > 0) {
    await traceAgentStash(ctx, "upload.staleHookSplitsRemoved", { items: traceItems(staleSplitHookItems) });
  }
  const nextFiles = new Map(existing.files);
  const deletedFiles = new Set<string>();

  for (const item of existing.manifest.items) {
    if (
      !itemIds.has(item.id)
      && !(item.kind === "hook" && uploadedHookEvents.has(item.name))
      && !isStaleSplitHookItem(item, replacedSplitHookEvents, existing.files)
    ) {
      continue;
    }
    for (const file of item.files) {
      nextFiles.delete(file.path);
      deletedFiles.add(file.path);
    }
  }
  for (const file of files) {
    nextFiles.set(file.path, file.content);
    deletedFiles.delete(file.path);
  }

  existing.manifest.profile = profile ?? existing.manifest.profile;
  existing.manifest.updatedAt = now.toISOString();
  existing.manifest.items = [
    ...existing.manifest.items.filter((item) => !itemIds.has(item.id)),
    ...items
  ]
    .filter((item) => {
      if (itemIds.has(item.id)) {
        return true;
      }
      return !(item.kind === "hook" && uploadedHookEvents.has(item.name))
        && !isStaleSplitHookItem(item, replacedSplitHookEvents, existing.files);
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  const writeInput: GistWriteInput = {
    description: "agent-stash portable agent config",
    files: gistFilesFromBundle(
      existing.manifest,
      [...nextFiles.entries()].map(([filePath, content]) => ({ path: filePath, content }))
    )
  };
  for (const filePath of deletedFiles) {
    writeInput.files[gistFilenameForBundlePath(filePath)] = null;
  }
  return writeInput;
}

function hookEventsForItems(items: AgentStashManifest["items"], files: BundleFile[]): Set<string> {
  const filesByPath = new Map(files.map((file) => [file.path, file.content]));
  const events = new Set<string>();
  for (const item of items) {
    if (item.kind !== "hook") {
      continue;
    }
    const content = filesByPath.get(item.files[0]?.path ?? "");
    const event = content === undefined ? undefined : hookEventFromFragmentContent(content);
    if (event !== undefined && event !== item.name) {
      events.add(event);
    }
  }
  return events;
}

function hookEventsForEventLevelUpload(
  items: AgentStashManifest["items"],
  files: BundleFile[],
  selectedHooks: string[] | undefined
): Set<string> {
  const uploadedHookEvents = hookEventsForItems(items, files);
  if (selectedHooks === undefined) {
    return uploadedHookEvents;
  }
  const selected = new Set(selectedHooks);
  return new Set([...uploadedHookEvents].filter((event) => selected.has(event)));
}

function isStaleSplitHookItem(
  item: AgentStashManifest["items"][number],
  replacedSplitHookEvents: Set<string>,
  files: Map<string, string>
): boolean {
  if (item.kind !== "hook") {
    return false;
  }
  const content = files.get(item.files[0]?.path ?? "");
  const event = content === undefined ? undefined : hookEventFromFragmentContent(content);
  return event !== undefined && event !== item.name && replacedSplitHookEvents.has(event);
}

async function loadUploadInventory(ctx: AgentStashContext, options: UploadOptions) {
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
