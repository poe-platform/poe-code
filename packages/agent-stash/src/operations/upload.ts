import { createDefaultGistClient } from "../gist-client.js";
import { createEmptyManifest } from "../manifest.js";
import { loadInventory } from "../inventory.js";
import { gistFilenameForBundlePath, gistFilesFromBundle, loadBundleFromGist, verifyBundleHashes } from "../bundle.js";
import { recordProfilePush, resolveProfileGist } from "../profile-store.js";
import { MANIFEST_FILENAME } from "../manifest.js";
import { assertAgentStashScope, assertSelectedItemsFound } from "../validation.js";
import type { AgentStashContext, AgentStashManifest, BundleFile, GistClient, GistWriteInput, UploadOptions, UploadResult } from "../types.js";

export async function uploadBundle(ctx: AgentStashContext, options: UploadOptions): Promise<UploadResult> {
  assertAgentStashScope(options.scope);
  if (!options.yes) {
    throw new Error("Upload writes require --yes in non-interactive mode.");
  }
  const now = ctx.now?.() ?? new Date();
  const resolved = await resolveProfileGist(ctx, options.profile, options.gist);
  const items = await loadUploadInventory(ctx, options);
  assertSelectedItemsFound(items, options);
  const client = ctx.gistClient ?? (await createDefaultGistClient());
  const selectedItems = items.map(({ bundleFiles: _bundleFiles, targetPath: _targetPath, ...item }) => item);
  const writeInput = resolved.gistId
    ? await createUpdateWriteInput(ctx, client, resolved.gistId, selectedItems, items.flatMap((item) => item.bundleFiles), options.profile)
    : createCreateWriteInput(now, options.profile, selectedItems, items.flatMap((item) => item.bundleFiles));
  const record = resolved.gistId
    ? await client.update(resolved.gistId, writeInput)
    : await client.createSecret(writeInput);
  await recordProfilePush(ctx, options.profile, record.id, record.htmlUrl, now.toISOString());
  const uploadedManifest = loadBundleFromGist(record).manifest;
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
  profile: string | undefined
): Promise<GistWriteInput> {
  const now = ctx.now?.() ?? new Date();
  const record = await client.read(gistId);
  const existing = record.files[MANIFEST_FILENAME]
    ? loadBundleFromGist(record)
    : { manifest: createEmptyManifest(now, profile), files: new Map<string, string>() };
  verifyBundleHashes(existing);
  const itemIds = new Set(items.map((item) => item.id));
  const nextFiles = new Map(existing.files);
  const deletedFiles = new Set<string>();

  for (const item of existing.manifest.items) {
    if (!itemIds.has(item.id)) {
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
  ].sort((left, right) => left.id.localeCompare(right.id));

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
