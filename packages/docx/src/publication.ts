import { dirname, basename, type FileStat, type FileSystem } from "@poe-code/safe-fs/core";
import { archiveSettings, CancellationError, InputTypeError, ResourceLimitError, type ArchiveContext, type DocumentArchive } from "./archive.js";
import type { ArchiveSink, ArchiveWriteOptions } from "./archive-write.js";
import { DocumentPackage } from "./package.js";
import { parseDocumentXml, type XmlElement } from "./package-xml.js";
import { documentDialects } from "./dialect.js";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";
import { writeDocumentArchive } from "./document-write.js";

export interface PublicationInput { readonly path: string; readonly stat: FileStat }
export interface PublicationOptions {
  readonly input?: PublicationInput;
  readonly output?: string;
  readonly inPlace?: boolean;
  readonly force?: boolean;
  readonly dryRun?: boolean;
  readonly creation?: boolean;
  readonly json?: boolean;
}
export interface PublicationContext extends ArchiveContext {
  readonly filesystem?: FileSystem;
  readonly stdout?: ArchiveSink;
  readonly encoding: ArchiveWriteOptions;
}
export interface PublishedFile { readonly path: string; readonly bytes: number }
export interface PublicationResult { readonly published: readonly PublishedFile[]; readonly archiveSha256?: string }
export class PublicationError extends Error {
  constructor(
    readonly code: "conflict" | "permission" | "unsupported-publication" | "sink-failure",
    message: string,
    readonly published: readonly PublishedFile[] = [],
    readonly stdoutMayBePartial = false,
    options?: ErrorOptions
  ) { super(message, options); }
}
class PublicationCancellationError extends CancellationError {
  constructor(readonly published: readonly PublishedFile[], readonly stdoutMayBePartial: boolean, options: ErrorOptions) {
    super("Document publication cancelled.", options);
  }
}
export interface ExtractionPublicationOptions {
  readonly input?: PublicationInput;
  readonly force?: boolean;
  readonly dryRun?: boolean;
  readonly allowPartialOutput?: boolean;
}
export interface PublicationFile { readonly path: string; readonly bytes: Uint8Array }

function ownedOptions<T extends PublicationOptions | ExtractionPublicationOptions>(options: T, names: readonly string[]): T {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new InputTypeError("Expected publication options.");
  for (const key of Reflect.ownKeys(options)) {
    const descriptor = Object.getOwnPropertyDescriptor(options, key)!;
    if (typeof key !== "string" || !names.includes(key) || !("value" in descriptor))
      throw new InputTypeError("Unknown publication option.");
    if (key !== "input" && key !== "output" && descriptor.value !== undefined && typeof descriptor.value !== "boolean")
      throw new InputTypeError("Publication flags require boolean values.");
  }
  if (options.input && (typeof options.input !== "object" || typeof options.input.path !== "string"
    || !options.input.stat || typeof options.input.stat !== "object")) throw new InputTypeError("Expected admitted file identity.");
  return { ...options, ...(options.input ? { input: { path: options.input.path, stat: { ...options.input.stat } } } : {}) };
}
function pathValue(path: string): void {
  if (typeof path !== "string" || !path.startsWith("/") || path === "/" || path.includes("\0")
    || path.slice(1).split("/").some(part => !part || part === "." || part === ".."))
    throw new InputTypeError("Publication requires a normalized absolute VFS path.");
}
function identity(stat: FileStat, file: boolean): void {
  if (!stat.identityScope || !Number.isSafeInteger(stat.ino) || !Number.isSafeInteger(stat.dev)
    || (file && (!Number.isSafeInteger(stat.revision) || stat.revision! < 0)))
    throw new PublicationError("unsupported-publication", "Publication requires scoped identity and file revision guarantees.");
}
function cancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new CancellationError("Document publication cancelled.", { cause: signal.reason });
}
function failure(error: unknown, published: readonly PublishedFile[], signal: AbortSignal): PublicationError | PublicationCancellationError {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (signal.aborted || code === "cancelled") return new PublicationCancellationError([...published], false, { cause: error });
  const category = code === "EAGAIN" || code === "EEXIST" || code === "conflict" ? "conflict"
    : code === "ENOTSUP" || code === "unsupported-publication" ? "unsupported-publication"
    : code === "EACCES" || code === "EPERM" || code === "EROFS" || code === "permission" ? "permission"
    : "sink-failure";
  return new PublicationError(category, "Document publication did not complete.", [...published], false, { cause: error });
}
interface Destination { path: string; parent: FileStat; expected: FileStat | null }
async function destination(fs: FileSystem, path: string, options: PublicationOptions, signal: AbortSignal): Promise<Destination> {
  pathValue(path);
  cancelled(signal);
  const capabilities = fs.capabilitiesFor ? await fs.capabilitiesFor(path, { signal, create: true }) : fs.capabilities;
  if (capabilities.readOnly === true || capabilities.write === false)
    throw new PublicationError("permission", "Destination is not writable.");
  if (capabilities.atomicFileStaging !== true || !fs.createStagedFile || !fs.publishStagedFile || !fs.removeStagedFile)
    throw new PublicationError("unsupported-publication", "Destination lacks atomic owned staging.");
  const parent = await fs.lstat(dirname(path), { signal });
  if (parent.type !== "directory") throw new PublicationError("unsupported-publication", "Destination parent must be an identified directory.");
  identity(parent, false);
  let expected: FileStat | null = null;
  try { expected = await fs.lstat(path, { signal }); }
  catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
  if (expected) {
    if (expected.type !== "file") throw new PublicationError("conflict", "Destination must be a regular file.");
    identity(expected, true);
    if (!options.inPlace && !options.force) throw new PublicationError("conflict", "Existing output requires force.");
  }
  if (options.input && !options.inPlace) {
    pathValue(options.input.path);
    // A proven absent final entry is exclusively created; existing entries need adapter alias evidence.
    if (path === options.input.path) throw new PublicationError("conflict", "Input replacement requires in-place intent.");
    if (expected) {
      const comparison = await fs.compareEntry?.(path, fs, options.input.path, { signal }) ?? "unknown";
      if (comparison === "same") throw new PublicationError("conflict", "Input replacement requires in-place intent.");
      if (comparison !== "distinct") throw new PublicationError("unsupported-publication", "Input alias identity is unknown.");
    }
  }
  if (options.inPlace) {
    const input = options.input!;
    identity(input.stat, true);
    if (input.stat.type !== "file") throw new PublicationError("conflict", "In-place input must be a regular file.");
    if (!expected || (["identityScope", "ino", "dev", "type", "revision", "size", "mode", "nlink", "mtimeMs", "ctimeMs"] as const)
      .some(field => expected![field] !== input.stat[field]))
      throw new PublicationError("conflict", "Input changed since admission.");
    expected = { ...input.stat };
  }
  cancelled(signal);
  return { path, parent, expected };
}
let stagingSequence = 0;
async function publish(fs: FileSystem, target: Destination, bytes: Uint8Array, signal: AbortSignal, published: PublishedFile[]): Promise<void> {
  cancelled(signal);
  // Staging acquisition is exclusive; a collision refuses without guessing ownership.
  const directory = `${dirname(target.path) === "/" ? "" : dirname(target.path)}/.docx-stage-${++stagingSequence}`;
  const stage = await fs.createStagedFile!(directory, basename(target.path), { type: "file", data: bytes }, { parent: target.parent, signal });
  let error: unknown;
  let failed = false;
  try {
    cancelled(signal);
    await fs.publishStagedFile!(stage, target.path, { parent: target.parent, destination: target.expected, signal });
    // The adapter receipt wins over cancellation arriving after commit.
    published.push({ path: target.path, bytes: bytes.length });
  } catch (cause) { failed = true; error = cause; }
  try { await fs.removeStagedFile!(stage); }
  catch (cause) { if (!failed) { failed = true; error = cause; } }
  if (failed) throw error;
}

export function assertDocumentEditable(archive: DocumentArchive, { limits, budget }: ReturnType<typeof archiveSettings>, controlSource?: DocumentArchive): void {
  // Until feature-specific authorization is implemented, protected packages fail closed.
  const packageView = new DocumentPackage(archive, limits, budget);
  for (const part of packageView.parts) {
    const type = part.content_type.toLowerCase();
    if (type.includes("digital-signature")) throw new UnsupportedEditError("Signed package publication is not supported.");
    if (!type.endsWith("+xml") && type !== "application/xml" && type !== "text/xml") continue;
    const current = controlSource ? new DocumentXmlEditor(part.bytes, {}, undefined, budget) : undefined;
    const originalPart = controlSource?.members.find(member => "/" + member.name === part.partname);
    const original = originalPart ? new DocumentXmlEditor(originalPart.bytes, {}, undefined, budget) : undefined;
    const root = current?.root ?? parseDocumentXml(part.bytes, {}, budget).root;
    const stack = [{ node: root, path: [] as number[], ancestors: [root] }];
    while (stack.length) {
      const { node, path, ancestors } = stack.pop()!;
      let preservedControlLock = false;
      if (original && current && node.localName === "lock" && ancestors.at(-2)?.localName === "sdtPr" && ancestors.at(-3)?.localName === "sdt" && ancestors.slice(-3).every(owner => owner.namespace === node.namespace)) {
        let source: XmlElement | undefined = original.root; const sourceAncestors = [source];
        for (const index of path) { source = source?.children[index]; if (!source) break; sourceAncestors.push(source); }
        const properties = ancestors.at(-2)!, owner = ancestors.at(-3)!, oldProperties = sourceAncestors.at(-2), oldOwner = sourceAncestors.at(-3);
        const inherited = (chain: readonly XmlElement[]) => JSON.stringify(chain.slice(0, -3).map(ancestor => ancestor.attributes.filter(attribute => ["http://www.w3.org/XML/1998/namespace", "http://schemas.openxmlformats.org/markup-compatibility/2006"].includes(attribute.namespace)).map(attribute => [attribute.namespace, attribute.localName, attribute.value])));
        if (source && oldProperties && oldOwner && source.namespace === node.namespace && source.localName === "lock" && oldProperties.localName === "sdtPr" && oldOwner.localName === "sdt" &&
          current.sourceXml(properties) === original.sourceXml(oldProperties) && inherited(ancestors) === inherited(sourceAncestors) && owner.namespaces.size === oldOwner.namespaces.size && [...owner.namespaces].every(([prefix, uri]) => oldOwner.namespaces.get(prefix) === uri)) {
          const lock = node.attributes.find(attribute => attribute.namespace === node.namespace && attribute.localName === "val")?.value;
          preservedControlLock = lock === "unlocked" || current.sourceXml(owner) === original.sourceXml(oldOwner);
        }
      }
      if ((Object.values(documentDialects).some(dialect => node.namespace === dialect.w)
        && (["documentProtection", "writeProtection"].includes(node.localName) || node.localName === "lock" && !preservedControlLock))
        || node.namespace === "http://www.w3.org/2000/09/xmldsig#"
        || node.attributes.some(attribute => attribute.localName === "Type" && attribute.value.includes("/digital-signature/")))
        throw new UnsupportedEditError("Protected or signed package publication is not supported.");
      node.children.forEach((child, index) => stack.push({ node: child, path: [...path, index], ancestors: [...ancestors, child] }));
    }
  }
}

export async function publishDocumentArchive(archive: DocumentArchive, options: PublicationOptions, context: PublicationContext, controlSource?: DocumentArchive): Promise<PublicationResult> {
  options = ownedOptions(options, ["input", "output", "inPlace", "force", "dryRun", "creation", "json"]);
  context = { ...context, encoding: { ...context.encoding } };
  const settings = archiveSettings(context);
  const { signal, budget, limits } = settings;
  const { output, inPlace, force, dryRun, creation, json } = options;
  if ((output !== undefined && (typeof output !== "string" || !output)) || (output !== undefined && inPlace)
    || (!dryRun && output === undefined && !inPlace) || (creation && (inPlace || (!dryRun && output === undefined)))
    || (force && (output === undefined || output === "-")) || (inPlace && (!options.input || options.input.path === "-"))
    || (output === "-" && json && !dryRun)) throw new InputTypeError("Invalid document publication intent.");
  const published: PublishedFile[] = [];
  let target: Destination | undefined;
  const path = inPlace ? options.input!.path : output;
  assertDocumentEditable(archive, settings, controlSource);
  const chunks: Uint8Array[] = [];
  let size = 0;
  let stagingFailure: unknown;
  try { await writeDocumentArchive(archive, { async write(bytes) {
    try {
      if (bytes.length > limits.maxArchiveBytes - size) throw new ResourceLimitError("Document output byte limit exceeded.");
      budget.charge("retainedBytes", bytes.length * 2 + 64);
      chunks.push(new Uint8Array(bytes)); size += bytes.length;
    } catch (error) { stagingFailure = error; throw error; }
  } }, context.encoding, { ...context, budget });
  } catch (error) { throw stagingFailure ?? error; }
  cancelled(signal);
  if (path !== undefined && path !== "-") {
    if (!context.filesystem) throw new InputTypeError("Publication requires an explicit filesystem.");
    try { target = await destination(context.filesystem, path, options, signal); }
    catch (error) { if (error instanceof InputTypeError) throw error; throw failure(error, published, signal); }
  }
  if (output === "-" && !dryRun && !context.stdout) throw new InputTypeError("Binary output requires an explicit stdout sink.");
  if (dryRun) return { published };
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  budget.charge("work", bytes.length);
  const archiveSha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(n => n.toString(16).padStart(2, "0")).join("");
  cancelled(signal);
  if (output === "-") {
    try { await context.stdout!.write(bytes, signal); }
    catch (error) {
      if (signal.aborted || error instanceof CancellationError) throw new PublicationCancellationError([], true, { cause: error });
      throw new PublicationError("sink-failure", "Binary stdout may contain partial output.", [], true, { cause: error });
    }
    return { published: [{ path: "-", bytes: size }], archiveSha256 };
  }
  try { await publish(context.filesystem!, target!, bytes, signal, published); }
  catch (error) { throw failure(error, published, signal); }
  return { published, archiveSha256 };
}

export async function publishDocumentFiles(files: readonly PublicationFile[], options: ExtractionPublicationOptions, context: ArchiveContext & { readonly filesystem: FileSystem }): Promise<PublicationResult> {
  options = ownedOptions(options, ["input", "force", "dryRun", "allowPartialOutput"]);
  context = { ...context };
  const { signal, limits, budget } = archiveSettings(context);
  if (files.length > 1 && !options.allowPartialOutput)
    throw new PublicationError("unsupported-publication", "Multiple files require explicit allowPartialOutput; this VFS has no transaction contract.");
  if (files.length > limits.maxMembers) throw new ResourceLimitError("Extraction file count exceeded.");
  const names = new Set<string>();
  let size = 0;
  const owned = files.map(file => {
    pathValue(file.path);
    if (names.has(file.path)) throw new InputTypeError("Duplicate extraction destination.");
    names.add(file.path);
    if (!(file.bytes instanceof Uint8Array)) throw new InputTypeError("Extraction requires byte arrays.");
    if (file.bytes.length > limits.maxEntryBytes || file.bytes.length > limits.maxTotalBytes - size)
      throw new ResourceLimitError("Extraction byte limit exceeded.");
    budget.charge("retainedBytes", file.bytes.length + 64); size += file.bytes.length;
    return { path: file.path, bytes: new Uint8Array(file.bytes) };
  });
  const published: PublishedFile[] = [];
  try {
    const targets: Destination[] = [];
    for (const file of owned) {
      targets.push(await destination(context.filesystem, file.path, options, signal));
      for (const other of targets.slice(0, -1)) {
        const current = targets[targets.length - 1]!;
        if (current.expected && other.expected) {
          const comparison = await context.filesystem.compareEntry?.(file.path, context.filesystem, other.path, { signal });
          if (comparison !== "distinct") throw new PublicationError("unsupported-publication", "Extraction destination identities must be distinct.");
        }
      }
    }
    if (!options.dryRun) for (let index = 0; index < owned.length; index++) {
      await publish(context.filesystem, targets[index]!, owned[index]!.bytes, signal, published);
    }
  } catch (error) { if (error instanceof InputTypeError) throw error; throw failure(error, published, signal); }
  return { published };
}
