import { createDefaultGistClient } from "../gist-client.js";
import { createEmptyManifest, parseManifest } from "../manifest.js";
import { hookEventFromFragmentContent } from "../hook-items.js";
import {
  alignHookOrigins,
  hookOriginsMatchEventGroups,
  readHookOriginStore,
  writeHookOriginStore
} from "../hook-origins.js";
import { loadInventory } from "../inventory.js";
import { gistFilenameForBundlePath, gistFilesFromBundle, loadBundleFromGist, parseLegacyHookChunkPath, verifyBundleHashes } from "../bundle.js";
import { readFileIfExists } from "../fs-utils.js";
import { readBaselineManifest, recordProfilePush, resolveProfileGist, writeBaselineManifest } from "../profile-store.js";
import { MANIFEST_FILENAME } from "../manifest.js";
import { traceAgentStash, traceAgentStashError, traceGistWriteInput, traceItems } from "../trace.js";
import { assertAgentStashScope, selectedHookMatchesName } from "../validation.js";
import { normalizeAgent } from "../locations.js";
import type { AgentStashContext, AgentStashManifest, BundleFile, GistClient, GistWriteInput, LoadedItem, UploadOptions, UploadResult } from "../types.js";

const UPLOAD_MANIFEST_READ_ATTEMPTS = 6;
const UPLOAD_MANIFEST_RETRY_DELAY_MS = 500;

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
  try {
    const now = ctx.now?.() ?? new Date();
    const resolved = await resolveProfileGist(ctx, options.profile, options.gist);
    const usesProfileTarget = options.profile !== undefined && options.gist === undefined;
    const profileName = usesProfileTarget ? options.profile : undefined;
    const items = await loadUploadInventory(ctx, options);
    const client = ctx.gistClient ?? (await createDefaultGistClient());
    await assertSelectedUploadItemsFound(ctx, client, resolved.gistId, items, options);
    const selectedItems = items.map(({ bundleFiles: _bundleFiles, targetPath: _targetPath, ...item }) => item);
    const localHookItems = resolved.gistId && options.hooks !== undefined
      ? await loadInventory(ctx, { scope: options.scope, agent: options.agent, kind: "hook" })
      : undefined;
    if (!resolved.gistId && selectedItems.length === 0) {
      throw new Error("No upload items selected.");
    }
    await traceAgentStash(ctx, "upload.inventory", { items: traceItems(selectedItems) });
    const writeInput = resolved.gistId
      ? await createUpdateWriteInput(ctx, client, resolved.gistId, selectedItems, items.flatMap((item) => item.bundleFiles), profileName, options, localHookItems)
      : createCreateWriteInput(now, profileName, selectedItems, items.flatMap((item) => item.bundleFiles));
    await traceAgentStash(ctx, resolved.gistId ? "upload.remote.update" : "upload.remote.create", {
      gistId: resolved.gistId,
      ...traceGistWriteInput(writeInput)
    });
    const record = resolved.gistId
      ? await client.update(resolved.gistId, writeInput)
      : await client.createSecret(writeInput);
    await recordHookOriginsForItems(ctx, items);
    await recordProfilePush(ctx, profileName, record.id, record.htmlUrl, now.toISOString());
    const manifestContent = writeInput.files[MANIFEST_FILENAME]?.content;
    if (manifestContent === undefined) {
      throw new Error(`Upload write input missing ${MANIFEST_FILENAME}.`);
    }
    const uploadedManifest = parseManifest(manifestContent);
    if (profileName) {
      await writeBaselineManifest(
        ctx,
        profileName,
        isFilteredUpload(options)
          ? mergeSelectedUploadBaseline(await readBaselineManifest(ctx, profileName), uploadedManifest, selectedItems)
          : uploadedManifest
      );
    }
    await traceAgentStash(ctx, "upload.finish", { gistId: record.id, uploaded: traceItems(selectedItems) });
    return { gistId: record.id, manifest: uploadedManifest, uploaded: selectedItems };
  } catch (error) {
    await traceAgentStashError(ctx, "upload.error", error);
    throw error;
  }
}

export async function recordHookOriginsForItems(
  ctx: AgentStashContext,
  items: readonly LoadedItem[]
): Promise<void> {
  const hookItems = items.filter((item) => item.kind === "hook");
  if (hookItems.length === 0) {
    return;
  }
  const selectedEventsByTarget = new Map<string, Set<string>>();
  for (const item of hookItems) {
    for (const file of item.bundleFiles) {
      const event = hookEventFromFragmentContent(file.content);
      if (!event) {
        continue;
      }
      const selectedEvents = selectedEventsByTarget.get(item.targetPath) ?? new Set<string>();
      selectedEvents.add(event);
      selectedEventsByTarget.set(item.targetPath, selectedEvents);
    }
  }
  if (selectedEventsByTarget.size === 0) {
    return;
  }
  const originStore = await readHookOriginStore(ctx);
  let changed = false;
  for (const [targetPath, events] of selectedEventsByTarget) {
    const content = await readFileIfExists(ctx.fs, targetPath);
    if (content === null) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(content) as unknown;
    } catch {
      continue;
    }
    if (!isRecord(parsed) || !isRecord(parsed.hooks)) {
      continue;
    }
    for (const event of events) {
      const eventGroups = parsed.hooks[event];
      if (!Array.isArray(eventGroups)) {
        continue;
      }
      const targetOrigins = originStore.targets[targetPath]?.[event] ?? [];
      if (hookOriginsMatchEventGroups(eventGroups, targetOrigins)) {
        continue;
      }
      originStore.targets[targetPath] ??= {};
      originStore.targets[targetPath][event] = alignHookOrigins(eventGroups, targetOrigins);
      changed = true;
    }
  }
  if (changed) {
    await writeHookOriginStore(ctx, originStore);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFilteredUpload(options: UploadOptions): boolean {
  return options.skills !== undefined || options.hooks !== undefined;
}

async function assertSelectedUploadItemsFound(
  ctx: AgentStashContext,
  client: GistClient,
  gistId: string | undefined,
  items: Array<Pick<AgentStashManifest["items"][number], "kind" | "name">>,
  options: UploadOptions
): Promise<void> {
  for (const skill of options.skills ?? []) {
    if (!items.some((item) => item.kind === "skill" && item.name === skill)) {
      throw new Error(`Selected skill not found: ${skill}`);
    }
  }
  const missingHooks = (options.hooks ?? []).filter(
    (hook) => !items.some((item) => item.kind === "hook" && selectedHookMatchesName(item.name, hook))
  );
  if (missingHooks.length === 0) {
    return;
  }
  if (!gistId) {
    throw new Error(`Selected hook not found: ${missingHooks[0]}`);
  }
  const remote = await loadExistingBundleForUpload(ctx, client, gistId, options.profile);
  for (const hook of missingHooks) {
    if (!remoteHasSelectedHookEvent(remote, hook)) {
      throw new Error(`Selected hook not found: ${hook}`);
    }
  }
}

function mergeSelectedUploadBaseline(
  base: AgentStashManifest | null,
  uploadedManifest: AgentStashManifest,
  selected: readonly AgentStashManifest["items"][number][]
): AgentStashManifest {
  const selectedIds = new Set(selected.map((item) => item.id));
  const nextById = new Map((base?.items ?? []).map((item) => [item.id, item]));
  for (const id of selectedIds) {
    nextById.delete(id);
  }
  for (const item of uploadedManifest.items) {
    if (selectedIds.has(item.id)) {
      nextById.set(item.id, item);
    }
  }
  return {
    ...uploadedManifest,
    items: [...nextById.values()].sort((left, right) => left.id.localeCompare(right.id))
  };
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
  options: UploadOptions,
  localHookItems: readonly LoadedItem[] | undefined
): Promise<GistWriteInput> {
  const now = ctx.now?.() ?? new Date();
  const record = await readUploadGistRecord(client, gistId);
  const hasExistingManifest = record.files[MANIFEST_FILENAME] !== undefined;
  const existing = hasExistingManifest
    ? loadBundleFromGist(record)
    : { manifest: createEmptyManifest(now, profile), files: new Map<string, string>() };
  verifyBundleHashes(existing, { allowUntrackedLegacyHookChunks: true });
  const itemIds = new Set(items.map((item) => item.id));
  const uploadTarget = { scope: options.scope, agentId: normalizeAgent(options.agent) };
  const fullUploadTarget = fullUploadReplacementTarget(options);
  const uploadedHookEvents = hookEventsForItems(items, files);
  const replacedSplitHookEvents = hookEventsForEventLevelUpload(items, files, options.hooks, existing, localHookItems);
  const replacedLegacyHookEvents = new Set([...uploadedHookEvents, ...replacedSplitHookEvents]);
  const legacyHookItems = existing.manifest.items.filter((item) => isReplacedLegacyHookItem(item, uploadedHookEvents, uploadTarget));
  if (legacyHookItems.length > 0) {
    await traceAgentStash(ctx, "upload.legacyHookChunksRemoved", { items: traceItems(legacyHookItems) });
  }
  const untrackedLegacyHookChunks = [...existing.files.keys()].filter((filePath) =>
    isReplacedLegacyHookChunkPath(filePath, replacedLegacyHookEvents, uploadTarget, fullUploadTarget)
  );
  if (untrackedLegacyHookChunks.length > 0) {
    await traceAgentStash(ctx, "upload.untrackedLegacyHookChunksRemoved", { files: untrackedLegacyHookChunks });
  }
  const staleSplitHookItems = existing.manifest.items.filter((item) => !itemIds.has(item.id) && isStaleSplitHookItem(item, replacedSplitHookEvents, existing.files, uploadTarget));
  if (staleSplitHookItems.length > 0) {
    await traceAgentStash(ctx, "upload.staleHookSplitsRemoved", { items: traceItems(staleSplitHookItems) });
  }
  const nextFiles = new Map(existing.files);
  const deletedFiles = new Set<string>();

  for (const item of existing.manifest.items) {
    if (
      !itemIds.has(item.id)
      && !isReplacedLegacyHookItem(item, uploadedHookEvents, uploadTarget)
      && !isStaleSplitHookItem(item, replacedSplitHookEvents, existing.files, uploadTarget)
      && !isReplacedByFullUpload(item, fullUploadTarget)
    ) {
      continue;
    }
    for (const file of item.files) {
      nextFiles.delete(file.path);
      deletedFiles.add(file.path);
    }
  }
  for (const filePath of untrackedLegacyHookChunks) {
    nextFiles.delete(filePath);
    deletedFiles.add(filePath);
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
      return !isReplacedLegacyHookItem(item, uploadedHookEvents, uploadTarget)
        && !isStaleSplitHookItem(item, replacedSplitHookEvents, existing.files, uploadTarget)
        && !isReplacedByFullUpload(item, fullUploadTarget);
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  const writeFiles = hasExistingManifest
    ? files
    : [...nextFiles.entries()].map(([filePath, content]) => ({ path: filePath, content }));
  const writeInput: GistWriteInput = {
    description: "agent-stash portable agent config",
    files: gistFilesFromBundle(existing.manifest, writeFiles)
  };
  if (!hasExistingManifest) {
    for (const filename of Object.keys(record.files)) {
      if (!Object.hasOwn(writeInput.files, filename)) {
        writeInput.files[filename] = null;
      }
    }
  }
  for (const filePath of deletedFiles) {
    writeInput.files[gistFilenameForBundlePath(filePath)] = null;
  }
  return writeInput;
}

function fullUploadReplacementTarget(options: UploadOptions): { scope: string; agentId: string } | undefined {
  if (isFilteredUpload(options)) {
    return undefined;
  }
  return { scope: options.scope, agentId: normalizeAgent(options.agent) };
}

function isReplacedByFullUpload(
  item: AgentStashManifest["items"][number],
  target: { scope: string; agentId: string } | undefined
): boolean {
  return target !== undefined && item.scope === target.scope && item.agentId === target.agentId;
}

function isReplacedLegacyHookItem(
  item: AgentStashManifest["items"][number],
  uploadedHookEvents: Set<string>,
  uploadTarget: { scope: string; agentId: string }
): boolean {
  return item.kind === "hook"
    && item.scope === uploadTarget.scope
    && item.agentId === uploadTarget.agentId
    && uploadedHookEvents.has(item.name);
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
  selectedHooks: string[] | undefined,
  existing: { manifest: AgentStashManifest; files: Map<string, string> },
  localHookItems: readonly LoadedItem[] | undefined
): Set<string> {
  const uploadedHookEvents = hookEventsForItems(items, files);
  if (selectedHooks === undefined) {
    return uploadedHookEvents;
  }
  const selected = new Set(selectedHooks);
  return new Set([
    ...[...uploadedHookEvents].filter((event) => selected.has(event)),
    ...selectedHooks.filter((hook) => remoteHasSelectedHookEvent(existing, hook)),
    ...hookEventsForFullySelectedLocalSplitUpload(items, uploadedHookEvents, localHookItems)
  ]);
}

function hookEventsForFullySelectedLocalSplitUpload(
  selectedItems: AgentStashManifest["items"],
  selectedEvents: Set<string>,
  localHookItems: readonly LoadedItem[] | undefined
): Set<string> {
  if (localHookItems === undefined || selectedEvents.size === 0) {
    return new Set();
  }
  const selectedIdsByEvent = new Map<string, Set<string>>();
  for (const item of selectedItems) {
    if (item.kind !== "hook") {
      continue;
    }
    const event = [...selectedEvents].find((candidate) => item.name !== candidate && item.name.startsWith(`${candidate}-`));
    if (event === undefined) {
      continue;
    }
    const selectedIds = selectedIdsByEvent.get(event) ?? new Set<string>();
    selectedIds.add(item.id);
    selectedIdsByEvent.set(event, selectedIds);
  }

  const localIdsByEvent = new Map<string, Set<string>>();
  const localPositionsByEvent = new Map<string, Map<number, Set<number>>>();
  for (const item of localHookItems) {
    if (item.kind !== "hook") {
      continue;
    }
    const content = item.bundleFiles[0]?.content ?? "";
    const event = hookEventFromFragmentContent(content);
    if (event === undefined || !selectedEvents.has(event) || event === item.name) {
      continue;
    }
    const position = hookFragmentPosition(content);
    if (position === undefined) {
      continue;
    }
    const localIds = localIdsByEvent.get(event) ?? new Set<string>();
    localIds.add(item.id);
    localIdsByEvent.set(event, localIds);
    const groups = localPositionsByEvent.get(event) ?? new Map<number, Set<number>>();
    const hooks = groups.get(position.groupIndex) ?? new Set<number>();
    hooks.add(position.hookIndex);
    groups.set(position.groupIndex, hooks);
    localPositionsByEvent.set(event, groups);
  }

  const fullySelected = new Set<string>();
  for (const [event, localIds] of localIdsByEvent) {
    const selectedIds = selectedIdsByEvent.get(event);
    if (
      selectedIds !== undefined
      && splitHookPositionsAreComplete(localPositionsByEvent.get(event))
      && localIds.size === selectedIds.size
      && [...localIds].every((id) => selectedIds.has(id))
    ) {
      fullySelected.add(event);
    }
  }
  return fullySelected;
}

function hookFragmentPosition(content: string): { groupIndex: number; hookIndex: number } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !isRecord(parsed.agentStash)) {
    return undefined;
  }
  const { groupIndex, hookIndex } = parsed.agentStash;
  return isNonNegativeInteger(groupIndex) && isNonNegativeInteger(hookIndex)
    ? { groupIndex, hookIndex }
    : undefined;
}

function splitHookPositionsAreComplete(groups: Map<number, Set<number>> | undefined): boolean {
  if (groups === undefined || groups.size === 0) {
    return false;
  }
  const groupIndexes = [...groups.keys()].sort((left, right) => left - right);
  return groupIndexes.every((groupIndex, expectedGroupIndex) => {
    if (groupIndex !== expectedGroupIndex) {
      return false;
    }
    const hookIndexes = [...(groups.get(groupIndex) ?? [])].sort((left, right) => left - right);
    return hookIndexes.length > 0 && hookIndexes.every((hookIndex, expectedHookIndex) => hookIndex === expectedHookIndex);
  });
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

async function loadExistingBundleForUpload(
  ctx: AgentStashContext,
  client: GistClient,
  gistId: string,
  profile: string | undefined
): Promise<{ manifest: AgentStashManifest; files: Map<string, string> }> {
  const now = ctx.now?.() ?? new Date();
  const record = await readUploadGistRecord(client, gistId);
  const existing = record.files[MANIFEST_FILENAME] !== undefined
    ? loadBundleFromGist(record)
    : { manifest: createEmptyManifest(now, profile), files: new Map<string, string>() };
  verifyBundleHashes(existing, { allowUntrackedLegacyHookChunks: true });
  return existing;
}

function isReplacedLegacyHookChunkPath(
  filePath: string,
  replacedHookEvents: Set<string>,
  uploadTarget: { scope: string; agentId: string },
  fullUploadTarget: { scope: string; agentId: string } | undefined
): boolean {
  const chunk = parseLegacyHookChunkPath(filePath);
  if (chunk === undefined) {
    return false;
  }
  if (chunk.scope !== uploadTarget.scope || chunk.agentId !== uploadTarget.agentId) {
    return false;
  }
  if (fullUploadTarget !== undefined && chunk.scope === fullUploadTarget.scope && chunk.agentId === fullUploadTarget.agentId) {
    return true;
  }
  return replacedHookEvents.has(chunk.eventName);
}

async function readUploadGistRecord(client: GistClient, gistId: string): Promise<Awaited<ReturnType<GistClient["read"]>>> {
  let latest = await client.read(gistId);
  for (let attempt = 1; attempt < UPLOAD_MANIFEST_READ_ATTEMPTS && isNonEmptyGistWithoutManifest(latest); attempt += 1) {
    await sleep(UPLOAD_MANIFEST_RETRY_DELAY_MS);
    latest = await client.read(gistId);
  }
  return latest;
}

function isNonEmptyGistWithoutManifest(record: Awaited<ReturnType<GistClient["read"]>>): boolean {
  return record.files[MANIFEST_FILENAME] === undefined && Object.keys(record.files).length > 0;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function remoteHasSelectedHookEvent(
  existing: { manifest: AgentStashManifest; files: Map<string, string> },
  selectedHook: string
): boolean {
  return existing.manifest.items.some((item) => {
    if (item.kind !== "hook") {
      return false;
    }
    const content = existing.files.get(item.files[0]?.path ?? "");
    const event = content === undefined ? undefined : hookEventFromFragmentContent(content);
    return event === selectedHook;
  });
}

function isStaleSplitHookItem(
  item: AgentStashManifest["items"][number],
  replacedSplitHookEvents: Set<string>,
  files: Map<string, string>,
  uploadTarget: { scope: string; agentId: string }
): boolean {
  if (item.kind !== "hook") {
    return false;
  }
  if (item.scope !== uploadTarget.scope || item.agentId !== uploadTarget.agentId) {
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
