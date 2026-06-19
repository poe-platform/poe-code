import { createBackup } from "../backup-store.js";
import { loadBundleFromGist, verifyBundleHashes } from "../bundle.js";
import { createDefaultGistClient } from "../gist-client.js";
import { loadIgnoreMatcher, type IgnoreMatcher } from "../ignore.js";
import {
  isLocalTargetIgnored,
  targetPathForItem,
  validateItemForLocalWrite,
  validateTargetForLocalWrite,
  writeItemToLocal
} from "../local-writes.js";
import { normalizeAgent } from "../locations.js";
import { recordProfilePull, resolveProfileGist, writeBaselineManifest } from "../profile-store.js";
import { traceAgentStash, traceItems } from "../trace.js";
import { assertAgentStashScope, assertSelectedItemsFound, selectedHookMatchesName } from "../validation.js";
import type { AgentStashContext, DownloadOptions, DownloadResult } from "../types.js";

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
  const agentId = normalizeAgent(options.agent);
  const now = ctx.now?.() ?? new Date();
  const resolved = await resolveProfileGist(ctx, options.profile, options.gist);
  const usesProfileTarget = options.profile !== undefined && options.gist === undefined;
  const profileName = usesProfileTarget ? options.profile : undefined;
  if (!resolved.gistId) {
    throw new Error("A profile with a Gist or --gist is required.");
  }
  const client = ctx.gistClient ?? (await createDefaultGistClient());
  const gist = await client.read(resolved.gistId);
  const bundle = loadBundleFromGist(gist);
  verifyBundleHashes(bundle);
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
  await traceAgentStash(ctx, "download.remote.selected", { gistId: resolved.gistId, items: traceItems(selected) });
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
  const backupPaths = selected.map((item) => targetPathForItem(ctx, item));
  for (const item of selected) {
    await validateTargetForLocalWrite(ctx, item);
  }
  const backup = backupPaths.length > 0
    ? await createBackup(ctx, { command: "download", args: options as unknown as Record<string, unknown>, paths: backupPaths })
    : undefined;

  for (const { item, files } of selectedFiles) {
    await writeItemToLocal(ctx, item, files);
  }

  await recordProfilePull(ctx, profileName, gist.id, gist.htmlUrl, now.toISOString());
  if (profileName) {
    await writeBaselineManifest(ctx, profileName, bundle.manifest);
  }
  await traceAgentStash(ctx, "download.finish", {
    gistId: gist.id,
    downloaded: traceItems(selected),
    backupId: backup?.id
  });
  return { manifest: bundle.manifest, downloaded: selected, backupId: backup?.id };
}

function filterIgnoredRemoteItems(
  ctx: AgentStashContext,
  matcher: IgnoreMatcher,
  scope: DownloadOptions["scope"],
  items: DownloadResult["downloaded"]
): DownloadResult["downloaded"] {
  return items.filter((item) => !isLocalTargetIgnored(ctx, matcher, item, scope));
}
