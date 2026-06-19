import { createBackup } from "../backup-store.js";
import { loadBundleFromGist, verifyBundleHashes } from "../bundle.js";
import { createDefaultGistClient } from "../gist-client.js";
import { targetPathForItem, validateItemForLocalWrite, validateTargetForLocalWrite, writeItemToLocal } from "../local-writes.js";
import { normalizeAgent } from "../locations.js";
import { recordProfilePull, resolveProfileGist } from "../profile-store.js";
import { assertAgentStashScope } from "../validation.js";
import type { AgentStashContext, DownloadOptions, DownloadResult } from "../types.js";

export async function downloadBundle(ctx: AgentStashContext, options: DownloadOptions): Promise<DownloadResult> {
  assertAgentStashScope(options.scope);
  if (!options.yes) {
    throw new Error("Download writes require --yes in non-interactive mode.");
  }
  const agentId = normalizeAgent(options.agent);
  const now = ctx.now?.() ?? new Date();
  const resolved = await resolveProfileGist(ctx, options.profile, options.gist);
  if (!resolved.gistId) {
    throw new Error("A profile with a Gist or --gist is required.");
  }
  const client = ctx.gistClient ?? (await createDefaultGistClient());
  const gist = await client.read(resolved.gistId);
  const bundle = loadBundleFromGist(gist);
  verifyBundleHashes(bundle);
  const selected = bundle.manifest.items.filter(
    (item) => item.scope === options.scope && item.agentId === agentId
  );
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

  await recordProfilePull(ctx, options.profile, gist.id, gist.htmlUrl, now.toISOString());
  return { manifest: bundle.manifest, downloaded: selected, backupId: backup?.id };
}
