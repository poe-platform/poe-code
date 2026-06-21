import { createBackup } from "../backup-store.js";
import { loadBundleFromGist, verifyBundleHashes } from "../bundle.js";
import { createDefaultGistClient } from "../gist-client.js";
import { hookEventFromFragmentContent } from "../hook-items.js";
import { loadIgnoreMatcher, type IgnoreMatcher } from "../ignore.js";
import {
  isLocalTargetIgnored,
  removeLocalHookEvents,
  targetPathForItem,
  validateItemForLocalWrite,
  validateTargetForLocalWrite,
  writeItemToLocal
} from "../local-writes.js";
import { normalizeAgent } from "../locations.js";
import { MANIFEST_FILENAME } from "../manifest.js";
import { baselineNameForTarget, readBaselineManifest, recordProfilePull, resolveProfileGist, writeBaselineManifest } from "../profile-store.js";
import { traceAgentStash, traceAgentStashError, traceItems, traceItemSet } from "../trace.js";
import { assertAgentStashScope, assertSelectedItemsFound, selectedHookMatchesName } from "../validation.js";
import type { AgentStashContext, AgentStashManifest, AgentStashItem, DownloadOptions, DownloadResult, GistClient, GistRecord } from "../types.js";

const DOWNLOAD_MANIFEST_READ_ATTEMPTS = 6;
const DOWNLOAD_MANIFEST_RETRY_DELAY_MS = 500;

export async function downloadBundle(ctx: AgentStashContext, options: DownloadOptions): Promise<DownloadResult> {
  assertAgentStashScope(options.scope);
  if (!options.yes) {
    throw new Error("Download writes require --yes in non-interactive mode.");
  }
  await traceAgentStash(ctx, "download.start", {
    profile: options.profile,
    gist: options.gist,
    scope: options.scope,
    agent: options.agent,
    skills: options.skills,
    hooks: options.hooks
  });
  try {
    const agentId = normalizeAgent(options.agent);
    const now = ctx.now?.() ?? new Date();
    const resolved = await resolveProfileGist(ctx, options.profile, options.gist);
    const usesProfileTarget = options.profile !== undefined && options.gist === undefined;
    const profileName = usesProfileTarget ? options.profile : undefined;
    if (!resolved.gistId) {
      throw new Error("A profile with a Gist or --gist is required.");
    }
    const client = ctx.gistClient ?? (await createDefaultGistClient());
    const gist = await readDownloadGistRecord(client, resolved.gistId);
    const bundle = loadBundleFromGist(gist);
    verifyBundleHashes(bundle, { allowUntrackedLegacyHookChunks: true });
    const selected = filterIgnoredRemoteItems(ctx, await loadIgnoreMatcher(ctx, options.scope), options.scope, bundle.manifest.items.filter((item) => {
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
    }));
    assertSelectedItemsFound(selected, options);
    await traceAgentStash(ctx, "download.remote.selected", { gistId: resolved.gistId, ...traceItemSet(selected) });
    const selectedFiles = selected.map((item) => {
      const files = item.files.map((file) => {
        const content = bundle.files.get(file.path);
        if (content === undefined) {
          throw new Error(`Remote bundle is missing ${file.path}`);
        }
        return { path: file.path, content };
      });
      validateItemForLocalWrite(item, files);
      return { item, files };
    });
    const eventReplacements = hookEventReplacementsForDownload(ctx, options, selectedFiles);
    const backupPaths = [
      ...new Set([
        ...selected.map((item) => targetPathForItem(ctx, item)),
        ...eventReplacements.map((replacement) => targetPathForItem(ctx, replacement.referenceItem))
      ])
    ];
    for (const item of selected) {
      await validateTargetForLocalWrite(ctx, item);
    }
    const backup = backupPaths.length > 0
      ? await createBackup(ctx, { command: "download", args: options as unknown as Record<string, unknown>, paths: backupPaths })
      : undefined;

    for (const replacement of eventReplacements) {
      await removeLocalHookEvents(ctx, replacement.referenceItem, [...replacement.events]);
    }

    for (const { item, files } of selectedFiles) {
      await writeItemToLocal(ctx, item, files);
    }

    await recordProfilePull(ctx, profileName, gist.id, gist.htmlUrl, now.toISOString());
    const baselineName = baselineNameForTarget(profileName, gist.id);
    await writeBaselineManifest(
      ctx,
      baselineName,
      isFilteredDownload(options)
        ? mergeSelectedDownloadBaseline(await readBaselineManifest(ctx, baselineName), bundle.manifest, selected)
        : bundle.manifest
    );
    await traceAgentStash(ctx, "download.finish", {
      gistId: gist.id,
      downloaded: traceItems(selected),
      downloadedIds: selected.map((item) => item.id),
      backupId: backup?.id
    });
    return { manifest: bundle.manifest, downloaded: selected, backupId: backup?.id };
  } catch (error) {
    await traceAgentStashError(ctx, "download.error", error);
    throw error;
  }
}

async function readDownloadGistRecord(client: GistClient, gistId: string): Promise<GistRecord> {
  let latest = await client.read(gistId);
  for (let attempt = 1; attempt < DOWNLOAD_MANIFEST_READ_ATTEMPTS && isNonEmptyGistWithoutManifest(latest); attempt += 1) {
    if (attempt > 1) {
      await sleep(DOWNLOAD_MANIFEST_RETRY_DELAY_MS);
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

function isFilteredDownload(options: DownloadOptions): boolean {
  return options.skills !== undefined || options.hooks !== undefined;
}

function hookEventReplacementsForDownload(
  ctx: AgentStashContext,
  options: DownloadOptions,
  selectedFiles: readonly { item: AgentStashItem; files: readonly { path: string; content: string }[] }[]
): Array<{ referenceItem: AgentStashItem; events: Set<string> }> {
  const selectedHookEvents = options.hooks === undefined ? undefined : new Set(options.hooks);
  const replacementsByTarget = new Map<string, { referenceItem: AgentStashItem; events: Set<string> }>();
  for (const { item, files } of selectedFiles) {
    if (item.kind !== "hook") {
      continue;
    }
    const event = hookEventFromFragmentContent(files[0]?.content ?? "");
    if (event === undefined || (selectedHookEvents !== undefined && !selectedHookEvents.has(event))) {
      continue;
    }
    const targetPath = targetPathForItem(ctx, item);
    const replacement = replacementsByTarget.get(targetPath) ?? { referenceItem: item, events: new Set<string>() };
    replacement.events.add(event);
    replacementsByTarget.set(targetPath, replacement);
  }
  return [...replacementsByTarget.values()];
}

function mergeSelectedDownloadBaseline(
  base: AgentStashManifest | null,
  remoteManifest: AgentStashManifest,
  selected: readonly AgentStashItem[]
): AgentStashManifest {
  const selectedIds = new Set(selected.map((item) => item.id));
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

function filterIgnoredRemoteItems(
  ctx: AgentStashContext,
  matcher: IgnoreMatcher,
  scope: DownloadOptions["scope"],
  items: DownloadResult["downloaded"]
): DownloadResult["downloaded"] {
  return items.filter((item) => !isLocalTargetIgnored(ctx, matcher, item, scope));
}
