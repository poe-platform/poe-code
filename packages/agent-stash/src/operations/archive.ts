import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { createBackup } from "../backup-store.js";
import { loadBundleFromGist, verifyBundleHashes } from "../bundle.js";
import { createDefaultGistClient } from "../gist-client.js";
import { loadInventory } from "../inventory.js";
import { normalizeAgent } from "../locations.js";
import { createEmptyManifest, MANIFEST_FILENAME, parseManifest, serializeManifest, validateBundlePath } from "../manifest.js";
import { targetPathForItem, validateItemForLocalWrite, validateTargetForLocalWrite, writeItemToLocal } from "../local-writes.js";
import { resolveProfileGist } from "../profile-store.js";
import { sha256 } from "../hash.js";
import { assertAgentStashScope } from "../validation.js";
import type {
  AgentStashContext,
  ArchiveCodec,
  BundleFile,
  ExportOptions,
  ExportResult,
  ImportOptions,
  ImportResult
} from "../types.js";

export async function exportArchive(ctx: AgentStashContext, options: ExportOptions): Promise<ExportResult> {
  if (options.scope !== undefined) {
    assertAgentStashScope(options.scope);
  }
  const archiveCodec = ctx.archiveCodec ?? new TarArchiveCodec();
  const bundle = await loadExportBundle(ctx, options);
  const archiveFiles: Record<string, string> = {
    [MANIFEST_FILENAME]: serializeManifest(bundle.manifest)
  };
  for (const file of bundle.files) {
    validateBundlePath(file.path);
    archiveFiles[file.path] = file.content;
  }
  await archiveCodec.write(options.outputPath, archiveFiles);
  return { outputPath: options.outputPath, manifest: bundle.manifest, exported: bundle.manifest.items };
}

export async function importArchive(ctx: AgentStashContext, options: ImportOptions): Promise<ImportResult> {
  assertAgentStashScope(options.scope);
  if (!options.yes) {
    throw new Error("Import writes require --yes in non-interactive mode.");
  }
  const agentId = normalizeAgent(options.agent);
  const archiveCodec = ctx.archiveCodec ?? new TarArchiveCodec();
  const archiveFiles = await archiveCodec.read(options.inputPath);
  for (const filePath of Object.keys(archiveFiles)) {
    validateBundlePath(filePath);
  }
  const manifestContent = archiveFiles[MANIFEST_FILENAME];
  if (manifestContent === undefined) {
    throw new Error(`Archive does not contain ${MANIFEST_FILENAME}`);
  }
  const manifest = parseManifest(manifestContent);
  const bundleFiles = new Map(Object.entries(archiveFiles).filter(([filePath]) => filePath !== MANIFEST_FILENAME));
  verifyArchiveHashes(manifest.items, bundleFiles);
  const selected = manifest.items.filter(
    (item) => item.scope === options.scope && item.agentId === agentId
  );
  const selectedFiles = selected.map((item) => {
    const files = item.files.map((file) => {
      const content = bundleFiles.get(file.path);
      if (content === undefined) {
        throw new Error(`Archive is missing ${file.path}`);
      }
      return { path: file.path, content };
    });
    validateItemForLocalWrite(item, files);
    return { item, files };
  });
  for (const item of selected) {
    await validateTargetForLocalWrite(ctx, item);
  }
  const backup = selected.length > 0
    ? await createBackup(ctx, {
        command: "import",
        args: options as unknown as Record<string, unknown>,
        paths: selected.map((item) => targetPathForItem(ctx, item))
      })
    : undefined;
  for (const { item, files } of selectedFiles) {
    await writeItemToLocal(ctx, item, files);
  }
  return { manifest, imported: selected, backupId: backup?.id };
}

async function loadExportBundle(
  ctx: AgentStashContext,
  options: ExportOptions
): Promise<{ manifest: ReturnType<typeof createEmptyManifest>; files: BundleFile[] }> {
  const agentId = options.agent === undefined ? undefined : normalizeAgent(options.agent);
  if (options.scope && options.agent) {
    const items = await loadInventory(ctx, { scope: options.scope, agent: options.agent });
    const manifest = createEmptyManifest(ctx.now?.() ?? new Date(), options.profile);
    manifest.items = items.map(({ bundleFiles: ignoredBundleFiles, targetPath: ignoredTargetPath, ...item }) => {
      void ignoredBundleFiles;
      void ignoredTargetPath;
      return item;
    });
    return { manifest, files: items.flatMap((item) => item.bundleFiles) };
  }

  const resolved = await resolveProfileGist(ctx, options.profile, options.gist);
  if (!resolved.gistId) {
    throw new Error("Export requires --scope and --agent for local archives, or a profile/--gist for remote archives.");
  }
  const client = ctx.gistClient ?? (await createDefaultGistClient());
  const bundle = loadBundleFromGist(await client.read(resolved.gistId));
  verifyBundleHashes(bundle);
  const selected = bundle.manifest.items.filter(
    (item) =>
      (options.scope === undefined || item.scope === options.scope) &&
      (agentId === undefined || item.agentId === agentId)
  );
  const selectedPaths = new Set(selected.flatMap((item) => item.files.map((file) => file.path)));
  return {
    manifest: { ...bundle.manifest, items: selected },
    files: [...bundle.files.entries()]
      .filter(([filePath]) => selectedPaths.has(filePath))
      .map(([filePath, content]) => ({ path: filePath, content }))
  };
}

function verifyArchiveHashes(
  items: ReturnType<typeof parseManifest>["items"],
  bundleFiles: Map<string, string>
): void {
  const expectedPaths = new Set<string>();
  for (const item of items) {
    for (const file of item.files) {
      expectedPaths.add(file.path);
      const content = bundleFiles.get(file.path);
      if (content === undefined) {
        throw new Error(`Archive is missing ${file.path}`);
      }
      if (Buffer.byteLength(content, "utf8") !== file.size || sha256(content) !== file.sha256) {
        throw new Error(`Archive file hash mismatch for ${file.path}`);
      }
    }
  }
  for (const filePath of bundleFiles.keys()) {
    if (!expectedPaths.has(filePath)) {
      throw new Error(`Archive contains untracked file ${filePath}`);
    }
  }
}

class TarArchiveCodec implements ArchiveCodec {
  async write(outputPath: string, files: Record<string, string>): Promise<void> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-stash-archive-"));
    try {
      for (const [filePath, content] of Object.entries(files)) {
        validateBundlePath(filePath);
        const targetPath = path.join(tempDir, ...filePath.split("/"));
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, content);
      }
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await tar.create({ cwd: tempDir, gzip: true, file: outputPath }, ["."]);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  async read(inputPath: string): Promise<Record<string, string>> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-stash-import-"));
    try {
      await tar.extract({
        cwd: tempDir,
        file: inputPath,
        strict: true,
        filter(entryPath, entry) {
          validateArchiveEntry(entryPath, entry);
          return true;
        }
      });
      return await filesFromDirectory(tempDir);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
}

export function validateArchiveEntryPath(entryPath: string): void {
  const normalized = entryPath.replace(/^\.\//, "").replace(/\/+$/, "");
  if (normalized.length === 0 || normalized === ".") {
    return;
  }
  validateBundlePath(normalized);
}

export function validateArchiveEntry(entryPath: string, entry?: unknown): void {
  validateArchiveEntryPath(entryPath);
  const entryType = archiveEntryType(entry);
  if (entryType !== undefined && entryType !== "File" && entryType !== "Directory") {
    throw new Error(`Archive contains unsupported entry type ${entryType}: ${entryPath}`);
  }
}

function archiveEntryType(entry: unknown): string | undefined {
  if (typeof entry !== "object" || entry === null || !("type" in entry)) {
    return undefined;
  }
  const type = (entry as { type?: unknown }).type;
  return typeof type === "string" ? type : undefined;
}

async function filesFromDirectory(root: string): Promise<Record<string, string>> {
  const files: Record<string, { filename: string; content: string }> = {};
  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`Archive contains unsupported entry: ${path.relative(root, fullPath)}`);
      }
      const relative = path.relative(root, fullPath).split(path.sep).join("/");
      validateBundlePath(relative);
      files[relative] = {
        filename: relative,
        content: await fs.readFile(fullPath, "utf8")
      };
    }
  }
  await walk(root);
  return Object.fromEntries(Object.entries(files).map(([filePath, file]) => [filePath, file.content]));
}
