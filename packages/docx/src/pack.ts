import { admitPackingFiles } from "./packing-vfs-admission.js";
import { validateArchiveNamespace } from "./archive-namespace.js";
import { dirname, type FileSystem } from "@poe-code/safe-fs/core";
import { archiveSettings, CancellationError, InvalidContainerError, ResourceLimitError, type ArchiveContext, type ArchiveMember } from "./archive.js";
import { admitDocumentArchive } from "./admission.js";
import { InvalidPackageError } from "./package-xml.js";
import { validateDocxInvocation, SourceError } from "./command.js";
import { admitPackageInventory, inventoryPath } from "./pack-inventory.js";
import { publishDocumentArchive, PublicationError } from "./publication.js";
import type { CreateMutationData } from "./create.js";
import type { DocxOperationArguments } from "./operation-types.js";

export interface ArchivePackingContext extends ArchiveContext {
  readonly filesystem: FileSystem;
  readonly inventoryDirectory?: string;
  readonly stdout?: { write(bytes: Uint8Array, signal: AbortSignal): Promise<void> };
}

/** Reconstructs only explicitly authenticated VFS payloads, with one staged publication. */
export async function packDocumentArchive(input: unknown, options: DocxOperationArguments<"pack">, context: ArchivePackingContext): Promise<CreateMutationData> {
  const settings = archiveSettings(context), { budget, signal, limits } = settings;
  if (signal.aborted) throw new CancellationError("Archive packing cancelled.", { cause: signal.reason });
  const admitted = validateDocxInvocation({ operation: "pack", inputs: ["-"], options }, budget).options;
  const directory = context.inventoryDirectory;
  if (directory !== undefined && directory !== "/") inventoryPath(directory, true);
  const inventory = admitPackageInventory(input, budget, directory === undefined);
  if (inventory.entries.length + (inventory.directories?.length ?? 0) > limits.maxMembers) throw new ResourceLimitError("Packing member limit exceeded.");
  const files = inventory.entries.map(entry => ({ entry, path: directory === undefined ? entry.path : (directory === "/" ? "" : directory) + "/" + entry.path }));
  const namespace = [...inventory.entries.map(e => ({ name: e.part === "[Content_Types].xml" ? e.part : e.part.slice(1), directory: false })), ...(inventory.directories ?? []).map(name => ({ name: name + "/", directory: true }))];
  for (const member of namespace) {
    const name = member.directory ? member.name.slice(0, -1) : member.name;
    if (new TextEncoder().encode(member.name).length > limits.maxPathBytes || name.split("/").length > limits.maxDepth) throw new ResourceLimitError("Packing path limit exceeded.");
  }
  for (const { path } of files) {
    if (new TextEncoder().encode(path).length > limits.maxPathBytes || path.split("/").length - 1 > limits.maxDepth) throw new ResourceLimitError("Packing VFS path limit exceeded.");
  }
  validateArchiveNamespace(namespace, budget);
  validateArchiveNamespace(files.map(f => ({ name: f.path.slice(1), directory: false })), budget);
  const common = files.map(f => dirname(f.path).split("/"));
  let shared = common[0]!.length;
  for (const parts of common.slice(1)) { let i = 0; while (i < shared && parts[i] === common[0]![i]) i++; shared = i; }
  const inputTree = directory ?? (common[0]!.slice(0, shared).join("/") || "/");
  const output = admitted.output as string | undefined;
  if (output !== undefined && output !== "-") {
    inventoryPath(output, true);
    const key = output.normalize("NFC").toUpperCase().toLowerCase(), treeKey = inputTree.normalize("NFC").toUpperCase().toLowerCase();
    if (inputTree === "/" || key === treeKey || key.startsWith(treeKey + "/")) throw new PublicationError("conflict", "Packed output must be outside the input tree.");
  }
  const fs = context.filesystem;
  const directories = new Set<string>();
  const checkParents = async (path: string) => {
    const parents = path.split("/").slice(1, -1); let parent = "";
    for (const segment of parents) {
      parent += "/" + segment;
      if (directories.has(parent)) continue;
      const stat = await fs.lstat(parent, { signal });
      if (stat.type !== "directory" || await fs.realpath(parent, { signal }) !== parent) throw new InvalidContainerError("Inventory VFS ancestors must be canonical directories.");
      directories.add(parent);
    }
  };
  if (output !== undefined && output !== "-") await checkParents(output);
  try {
    await admitPackingFiles(files.map(({ entry, path }) => ({ path, bytes: entry.bytes })), { filesystem: fs, signal, budget });
  } catch (error) {
    if (error instanceof InvalidContainerError || error instanceof ResourceLimitError || error instanceof CancellationError) throw error;
    throw new SourceError(error);
  }
  const members: ArchiveMember[] = [];
  let total = 0;
  for (const { entry, path } of files) {
    await budget.checkpoint(1);
    try {
      await checkParents(path);
      const stat = await fs.lstat(path, { signal });
      if (stat.type !== "file" || await fs.realpath(path, { signal }) !== path) throw new InvalidContainerError("Inventory payloads must be canonical regular files.");
      if (stat.size !== entry.bytes) throw new InvalidContainerError("Inventory payload byte length mismatch.");
      if (entry.bytes > limits.maxEntryBytes || entry.bytes > limits.maxTotalBytes - total) throw new ResourceLimitError("Packing payload limit exceeded.");
      total += entry.bytes; budget.charge("retainedBytes", entry.bytes * 2 + 128);
      const bytes = new Uint8Array(entry.bytes); let offset = 0;
      const source = fs.readStream ? fs.readStream(path, { signal }) : { async *[Symbol.asyncIterator]() { yield await fs.readFile(path, { signal }); } };
      for await (const chunk of source) {
        if (!(chunk instanceof Uint8Array) || chunk.length > bytes.length - offset) throw new InvalidContainerError("Inventory payload byte length mismatch.");
        await budget.checkpoint(chunk.length + 1);
        bytes.set(chunk, offset); offset += chunk.length;
      }
      if (offset !== bytes.length) throw new InvalidContainerError("Inventory payload byte length mismatch.");
      const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
      if (digest !== entry.sha256) throw new InvalidContainerError("Inventory payload hash mismatch.");
      members.push({ name: entry.part === "[Content_Types].xml" ? entry.part : entry.part.slice(1), bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") });
    } catch (error) {
      if (signal.aborted) throw new CancellationError("Archive packing cancelled.", { cause: signal.reason });
      if (error instanceof InvalidContainerError || error instanceof ResourceLimitError || error instanceof CancellationError) throw error;
      throw new SourceError(error);
    }
  }
  for (const name of inventory.directories ?? []) members.push({ name: name + "/", bytes: new Uint8Array(), directory: true, modified: new Date("1980-01-01T00:00:00Z") });
  const archive = await admitDocumentArchive({ members, comment: new Uint8Array() }, settings);
  if (archive.kind !== inventory.kind || archive.dialect !== inventory.dialect || admitted.kind !== undefined && admitted.kind !== archive.kind) throw new InvalidPackageError("Inventory kind or dialect conflicts with its package.");
  for (const { entry } of files) {
    const type = entry.part === "[Content_Types].xml" ? "application/xml" : archive.package.getPart(entry.part).content_type;
    if (type !== entry.contentType) throw new InvalidPackageError("Inventory content type conflicts with its package.");
  }
  if (output !== undefined && output !== "-" && admitted.force === true) {
    let existing = false;
    try { await fs.lstat(output, { signal }); existing = true; }
    catch (error) { if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw new SourceError(error); }
    if (existing) for (const { path } of files) {
      const comparison = await fs.compareEntry?.(output, fs, path, { signal }) ?? "unknown";
      if (comparison === "same") throw new PublicationError("conflict", "Packed output aliases an input payload.");
      if (comparison !== "distinct") throw new PublicationError("unsupported-publication", "Packed output alias identity is unknown.");
    }
  }
  const dryRun = admitted.dryRun === true;
  const prospective = { version: 1, operation: "pack", ok: true, data: { changed: true, changes: [], dryRun, output: dryRun ? null : { path: output, bytes: limits.maxArchiveBytes, sha256: "0".repeat(64) } }, warnings: [], errors: [], affected: 1, locations: [] };
  if (output !== "-" || dryRun) budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify(prospective) + "\n").length);
  const result = await publishDocumentArchive(archive, { creation: true, ...(output === undefined ? {} : { output }), force: admitted.force === true, dryRun, json: admitted.json === true }, { ...settings, filesystem: fs, ...(context.stdout ? { stdout: context.stdout } : {}), encoding: { order: "name", compression: "store" } });
  return { changed: true, changes: [], dryRun, output: result.published.length ? { path: result.published[0]!.path, bytes: result.published[0]!.bytes, sha256: result.archiveSha256! } : null };
}
