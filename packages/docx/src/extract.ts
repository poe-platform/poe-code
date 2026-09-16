import { validateArchiveNamespace } from "./archive-namespace.js";
import { compareInventoryNames } from "./pack-inventory.js";
import { resolvePath, type FileSystem, type FileStat } from "@poe-code/safe-fs/core";
import { archiveSettings, CancellationError, ResourceLimitError, InvalidContainerError, type ArchiveContext } from "./archive.js";
import { readDocumentArchive } from "./admission.js";
import { validateDocxInvocation } from "./command.js";
import { asciiKey } from "./part-uri.js";
import { displayXml } from "./xml-display.js";
import { parseDocumentXmlAsync } from "./package-xml.js";
import { PublicationError } from "./publication.js";
import type { DocxOperationArguments } from "./operation-types.js";

export interface ArchiveExtractionData {
  readonly outputDir: string;
  readonly complete: boolean;
  readonly possiblePartialOutput: boolean;
  readonly entries: readonly { readonly path: string; readonly bytes: number; readonly sha256: string; readonly published: boolean }[];
  readonly manifestPublished: boolean;
}
export class ArchiveExtractionError extends Error {
  readonly code: "cancelled" | "limit-exceeded" | "conflict" | "unsupported-publication";
  constructor(cause: unknown, readonly data: ArchiveExtractionData, cancelled = false) {
    super(data.possiblePartialOutput ? "Archive extraction failed; partial new output may remain." : "Archive extraction destination refused.", { cause });
    this.code = cancelled ? "cancelled" : cause instanceof ResourceLimitError ? "limit-exceeded" : cause instanceof PublicationError && cause.code === "conflict" ? "conflict" : "unsupported-publication";
  }
}

/** Extracts inert bytes into a new explicit VFS tree; never removes user resources. */
export async function extractDocumentArchive(
  input: Uint8Array,
  options: DocxOperationArguments<"extract">,
  context: ArchiveContext & { readonly filesystem: FileSystem }
): Promise<ArchiveExtractionData> {
  const settings = archiveSettings(context), { budget, signal } = settings;
  const invocation = validateDocxInvocation({ operation: "extract", inputs: ["-"], options }, budget);
  const admitted = invocation.options as DocxOperationArguments<"extract">;
  if (!admitted.outputDir?.startsWith("/")) throw new InvalidContainerError("Extraction requires an absolute VFS destination.");
  const outputDir = resolvePath("/", admitted.outputDir), fs = context.filesystem;
  const archive = await readDocumentArchive(input, settings);
  validateArchiveNamespace(archive.members, budget);
  const files: { path: string; bytes: Uint8Array; sha256: string; published: boolean }[] = [];
  for (const member of archive.members) {
    if (member.directory || admitted.selection === "media-only" && !asciiKey(member.name).startsWith("word/media/")) continue;
    let bytes = member.bytes;
    if (admitted.pretty && (member.name.endsWith(".xml") || member.name.endsWith(".rels"))) {
      const parsed = await parseDocumentXmlAsync(bytes, {}, budget);
      bytes = new TextEncoder().encode(displayXml(parsed.root, budget, true));
      budget.charge("retainedBytes", bytes.length);
    }
    budget.charge("work", bytes.length);
    budget.charge("retainedBytes", bytes.length + 128);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
    files.push({ path: member.name, bytes, sha256: [...digest].map(b => b.toString(16).padStart(2, "0")).join(""), published: false });
  }
  const directories = archive.members.filter(m => m.directory && (admitted.selection !== "media-only" || asciiKey(m.name).startsWith("word/media/"))).map(m => m.name.slice(0, -1));
  const manifest = { version: 1, kind: archive.kind, dialect: archive.dialect, selection: admitted.selection ?? "all", pretty: admitted.pretty ?? false,
    directories, entries: files.map(f => ({ part: f.path === "[Content_Types].xml" ? f.path : "/" + f.path, path: f.path, contentType: f.path === "[Content_Types].xml" ? "application/xml" : archive.package.getPart("/" + f.path).content_type, bytes: f.bytes.length, sha256: f.sha256 })).sort((a, b) => compareInventoryNames(a.part, b.part)) };
  const manifestText = JSON.stringify(manifest);
  budget.check("serializedOutput", new TextEncoder().encode(manifestText).length);
  budget.charge("retainedBytes", manifestText.length * 4);
  const manifestBytes = new TextEncoder().encode(manifestText);
  let possiblePartialOutput = false, manifestPublished = false;
  const data = (complete: boolean): ArchiveExtractionData => ({ outputDir, complete, possiblePartialOutput: !complete && possiblePartialOutput,
    entries: files.map(f => ({ path: f.path, bytes: f.bytes.length, sha256: f.sha256, published: f.published })), manifestPublished });
  const failureMessage = "Archive extraction failed; partial new output may remain.";
  const receipt = JSON.stringify({ version: 1, operation: "extract", ok: false, data: data(false), affected: 0, locations: [], warnings: [],
    errors: [{ code: "unsupported-publication", message: failureMessage }] });
  const receiptSize = new TextEncoder().encode(receipt).length + 1;
  budget.check("serializedOutput", receiptSize);
  budget.check("diagnosticBytes", new TextEncoder().encode(`docx: unsupported-publication: ${failureMessage}\n`).length);
  budget.charge("retainedBytes", receiptSize * 12);
  budget.charge("work", receiptSize * 12);
  const parents = new Map<string, FileStat>();
  const capabilities = async (path: string) => {
    const caps = fs.capabilitiesFor ? await fs.capabilitiesFor(path, { create: true, signal }) : fs.capabilities;
    if (caps.readOnly || !caps.write || !caps.mkdir || !caps.explicitDirectories || !caps.atomicFileMutation || !caps.atomicDirectoryMetadata || !fs.prepareDirectory || !fs.writeFileConditional)
      throw new Error("Destination lacks safe exclusive publication capabilities.");
  };
  const verifyDirectory = async (path: string) => {
    const stat = await fs.lstat(path, { signal });
    if (stat.type !== "directory" || await fs.realpath(path, { signal }) !== path) throw new Error("Destination directory aliases are not supported.");
    await fs.access(path, 3, { signal });
    return stat;
  };
  try {
    await capabilities(outputDir);
    const outer = outputDir.slice(0, outputDir.lastIndexOf("/")) || "/";
    const outerStat = await verifyDirectory(outer);
    try { await fs.lstat(outputDir, { signal }); throw new PublicationError("conflict", "Destination already exists."); }
    catch (error) { if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error; }
    // A rejected provider operation may still have created new output.
    possiblePartialOutput = true;
    parents.set(outputDir, await fs.prepareDirectory!(outputDir, { parent: outerStat, expected: null, mode: 0o700, signal }));
    await verifyDirectory(outputDir);
    const prepareParents = async (segments: readonly string[]): Promise<string> => {
      let parentPath = outputDir;
      for (const segment of segments) {
        const ancestor = parentPath;
        parentPath += "/" + segment;
        if (!parents.has(parentPath)) {
          await capabilities(parentPath);
          parents.set(parentPath, await fs.prepareDirectory!(parentPath, { parent: parents.get(ancestor)!, expected: null, mode: 0o700, signal }));
          await verifyDirectory(parentPath);
        }
      }
      return parentPath;
    };
    for (const directory of directories) {
      await budget.checkpoint(1);
      await prepareParents(directory.split("/"));
    }
    for (const file of [...files, { path: "manifest.json", bytes: manifestBytes, published: false }]) {
      await budget.checkpoint(file.bytes.length + 1);
      const parentPath = await prepareParents(file.path.split("/").slice(0, -1));
      const path = outputDir + "/" + file.path;
      await capabilities(path);
      await fs.writeFileConditional!(path, file.bytes, { parent: parents.get(parentPath)!, expected: null, signal });
      file.published = true;
      if (file.path === "manifest.json") manifestPublished = true;
    }
    signal.throwIfAborted();
    return data(true);
  } catch (error) {
    throw new ArchiveExtractionError(error, data(false), signal.aborted || error instanceof CancellationError);
  }
}
