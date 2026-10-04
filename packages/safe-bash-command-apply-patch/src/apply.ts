import { bytesFrom } from "safe-bash-byte-engine";
import {
  createOutputOperation, dirname, readBytes, writeBytes,
  type ByteSource, type CommandContext, type FileReadHandle, type FileStaging, type FileStat, type FileSystem,
} from "safe-bash-contracts";
import { settings, type ApplyPatchLimits } from "./options.js";
import { parse, type PatchFile } from "./parser.js";
import { storedContents } from "./stored-matcher.js";
import { IndexedDocument, closeDocumentResources } from "safe-bash-diff-engine/document";
import { diagnostic, FileFailure, PatchError, Work } from "./shared.js";

interface Snapshot { readonly path: string; readonly stat: FileStat; document?: IndexedDocument; }
interface Plan { readonly file: PatchFile; readonly original?: Snapshot; readonly output?: IndexedDocument; }

function identity(stat: FileStat): boolean {
  return (typeof stat.identityScope === "symbol" || (typeof stat.identityScope === "object" && stat.identityScope !== null))
    && Number.isSafeInteger(stat.dev) && stat.dev! >= 0 && Number.isSafeInteger(stat.ino) && stat.ino! >= 0;
}

function relation(left: FileStat, right: FileStat): "same" | "distinct" | "unknown" {
  if (!identity(left) || !identity(right)) return "unknown";
  return left.identityScope === right.identityScope && left.dev === right.dev && left.ino === right.ino ? "same" : "distinct";
}

class Invocation {
  readonly work: Work;
  private readonly initial = new Map<string, FileStat | undefined>();
  private ordinal: number | undefined;
  private fs: FileSystem;
  private inputBytes = 0;
  private readonly documents = new Set<IndexedDocument>();

  constructor(readonly context: CommandContext, limits: ApplyPatchLimits) {
    this.work = new Work(context, limits);
    this.fs = context.fs;
  }

  private async confine(files: readonly PatchFile[]): Promise<void> {
    if (!this.fs.confineExtraction) throw new PatchError("filesystem does not support race-safe patch mutations");
    if (!this.fs.createStagedFile || !this.fs.publishStagedFile || !this.fs.removeFileConditional) throw new PatchError("filesystem does not support streamed conditional patch mutations");
    const roots = new Set<string>();
    for (const file of files) for (const path of [file.path, file.destination]) {
      if (!path) continue;
      const capabilities = await this.work.fs(path, async () => await this.fs.capabilitiesFor?.(path, { signal: this.context.signal }) ?? this.fs.capabilities);
      if (capabilities.atomicFileMutation !== true || capabilities.retainedStagingWrite !== true
        || capabilities.retainedStagingCleanup !== true || capabilities.atomicStagedFileMutation !== true) throw new PatchError("filesystem does not support atomic conditional patch mutations");
      let parent = dirname(path);
      while (!await this.inspect(parent, false)) {
        await this.work.charge(1);
        const next = dirname(parent);
        if (next === parent) throw new PatchError("missing VFS root");
        parent = next;
      }
      roots.add(parent);
    }
    // The backend retains these directories and all their ancestors. Every
    // mutation must enforce the retained ancestry atomically, including mkdir
    // and source deletion; a separate pathname recheck cannot provide this.
    this.fs = await this.work.fs(this.work.cwd, () => this.fs.confineExtraction!([...roots], { signal: this.context.signal }));
  }

  private async input(): Promise<string> {
    const { context, work } = this;
    work.check();
    if (context.args.length > 1) throw new PatchError("expected stdin or one literal patch argument", 2);
    if (context.args.length === 1) {
      const text = context.args[0]!;
      const bytes = await work.utf8(text, work.limits.maxPatchBytes, 2);
      context.inputBudget?.check(this.inputBytes += bytes);
      return text;
    }
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of readBytes(context.stdin, context.signal)) {
      work.count("maxInputChunks", 1);
      if (chunk.byteLength > work.limits.maxPatchBytes - bytes) throw new PatchError("maxPatchBytes limit exceeded");
      context.inputBudget?.check(this.inputBytes += chunk.byteLength);
      await work.charge(1);
      if (chunk.byteLength) chunks.push(await work.copy(chunk));
      bytes += chunk.byteLength;
      await work.checkpoint();
    }
    work.check();
    work.admit(bytes);
    const data = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { await work.copyInto(chunk, data, offset); offset += chunk.length; }
    return work.text(data, 2);
  }

  private async stat(path: string, cached: boolean): Promise<FileStat | undefined> {
    if (cached && this.initial.has(path)) return this.initial.get(path);
    let result: FileStat | undefined;
    try { result = { ...await this.work.fs(path, () => this.fs.lstat(path, { signal: this.context.signal })) }; }
    catch (error) { if (!(error instanceof FileFailure && error.error.code === "ENOENT")) throw error; }
    if (cached) this.initial.set(path, result);
    return result;
  }

  private async inspect(path: string, cached: boolean): Promise<FileStat | undefined> {
    const parts = path.split("/").filter(Boolean);
    let current = "/";
    for (let index = -1; index < parts.length; index++) {
      await this.work.charge(1);
      if (index >= 0) current = current === "/" ? current + parts[index]! : current + "/" + parts[index]!;
      const stat = await this.stat(current, cached);
      if (!stat) return undefined;
      if (stat.type === "symlink") throw new PatchError(`symlink paths are unsupported: ${current}`);
      if (index < parts.length - 1 && stat.type !== "directory") throw new PatchError(`not a directory: ${current}`);
      if (index === parts.length - 1) return stat;
    }
    return undefined;
  }

  private async writable(path: string): Promise<void> {
    let target = path;
    while (!await this.stat(target, true)) {
      await this.work.charge(1);
      const parent = dirname(target);
      if (parent === target) throw new PatchError("missing VFS root");
      target = parent;
    }
    try { await this.work.fs(target, () => this.fs.access(target, 2, { signal: this.context.signal })); }
    catch (error) {
      if (error instanceof FileFailure && (error.error.code === "ENOTSUP" || error.error.code === "EOPNOTSUPP")) {
        const capabilities = await this.work.fs(target, async () =>
          await this.fs.capabilitiesFor?.(target, { signal: this.context.signal }) ?? this.fs.capabilities);
        if (capabilities.permissions !== true) return;
      }
      throw error;
    }
  }

  private async *source(snapshot: Snapshot): ByteSource {
    const { path, stat: expected } = snapshot;
    const { work, context } = this;
    const fs = context.fs;
    const maximum = Math.min(work.limits.maxFileBytes, work.remaining("maxReadBytes"), (context.inputBudget?.maxBytes ?? Infinity) - this.inputBytes);
    const capabilities = await work.fs(path, async () => await fs.capabilitiesFor?.(path, { signal: context.signal }) ?? fs.capabilities);
    if (capabilities.retainedRead !== true || !fs.openReadFile) throw new PatchError("target requires identity-checked retained reads");
    let handle: FileReadHandle | undefined;
    const same = (actual: FileStat) => actual.type === "file" && relation(actual, expected) === "same"
      && actual.size === expected.size && actual.revision === expected.revision
      && actual.mode === expected.mode && actual.mtimeMs === expected.mtimeMs && actual.ctimeMs === expected.ctimeMs;
    try {
      await work.fs(path, async () => { handle = await fs.openReadFile!(path, { signal: context.signal }); });
      const stat = await work.fs(path, () => handle!.stat({ signal: context.signal }));
      if (!same(stat)) throw new PatchError(`target changed since preflight: ${path}`);
      if (stat.size > maximum) throw new PatchError("target read byte limit exceeded");
      let position = 0;
      while (position < stat.size) {
        const length = Math.min(16384, stat.size - position);
        const bytes = await work.fs(path, () => handle!.read(position, length, { signal: context.signal }));
        if (!bytes.length || bytes.length > length) throw new PatchError(`target changed while reading: ${path}`);
        context.inputBudget?.check(this.inputBytes += bytes.length);
        work.count("maxReadBytes", bytes.length);
        position += bytes.length;
        yield await work.copy(bytes);
      }
      if (!same(await work.fs(path, () => handle!.stat({ signal: context.signal })))) throw new PatchError(`target changed while reading: ${path}`);
    } finally { await handle?.close(); }
  }

  private async equal(left: IndexedDocument, right: IndexedDocument): Promise<boolean> {
    if (left === right) return true;
    if (left.size !== right.size) return false;
    for (let position = 0; position < left.size; position += 16384) {
      const length = Math.min(16384, left.size - position);
      if (!await this.work.equal(await left.data.read(8 + position, length), await right.data.read(8 + position, length))) return false;
    }
    return true;
  }

  private async prepare(files: readonly PatchFile[]): Promise<Plan[]> {
    if (this.fs.capabilities.readOnly === true) throw new PatchError("read-only file system");
    const snapshots: Snapshot[] = [];
    const byPath = new Map<string, Snapshot>();
    for (const file of files) {
      const stat = await this.inspect(file.path, true);
      if (stat && stat.type !== "file") throw new PatchError(`target is not a regular file: ${file.label}`);
      if (!stat && file.kind !== "add") throw new PatchError(`missing target: ${file.label}`);
      if (stat) {
        if (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > this.work.limits.maxFileBytes) throw new PatchError("target size limit exceeded or invalid size");
        const snapshot = { path: file.path, stat };
        snapshots.push(snapshot);
        byPath.set(file.path, snapshot);
      }
      if (file.destination && await this.inspect(file.destination, true)) throw new PatchError(`Move destination already exists: ${file.destinationLabel}`);
    }
    for (let left = 0; left < snapshots.length; left++) for (let right = left + 1; right < snapshots.length; right++) {
      const source = snapshots[left]!;
      const target = snapshots[right]!;
      await this.work.charge(1);
      let comparison = relation(source.stat, target.stat);
      if (comparison === "unknown" && this.fs.compareEntry) {
        comparison = await this.work.fs(source.path, () => this.fs.compareEntry!(source.path, this.fs, target.path, { signal: this.context.signal }));
        if (comparison !== "same" && comparison !== "distinct" && comparison !== "unknown") throw new PatchError("invalid entry comparison");
      }
      if (comparison === "same") throw new PatchError("patch operations refer to the same backing entry");
      await this.work.checkpoint();
    }
    for (const file of files) {
      await this.writable(file.kind === "delete" || file.destination ? dirname(file.path) : file.path);
      if (file.destination) await this.writable(file.destination);
    }
    for (const snapshot of snapshots) {
      const document = new IndexedDocument(this.work);
      this.documents.add(document);
      await this.work.fs(snapshot.path, () => document.load(this.source(snapshot)));
      snapshot.document = document;
    }
    const plans: Plan[] = [];
    for (const file of files) {
      const original = byPath.get(file.path);
      const output = await this.work.fs(file.path, () => storedContents(file, original?.document, this.work));
      if (output) this.documents.add(output);
      plans.push({ file, ...(original ? { original } : {}), ...(output ? { output } : {}) });
    }
    return plans;
  }

  private async unchanged(snapshot: Snapshot): Promise<void> {
    const stat = await this.inspect(snapshot.path, false);
    const before = snapshot.stat;
    if (!stat || stat.type !== "file" || stat.size !== before.size || stat.mode !== before.mode
      || stat.mtimeMs !== before.mtimeMs || stat.ctimeMs !== before.ctimeMs || relation(stat, before) === "distinct") {
      throw new PatchError(`target changed since preflight: ${snapshot.path}`);
    }
    let position = 0;
    for await (const bytes of this.source(snapshot)) {
      const before = await snapshot.document!.data.read(8 + position, bytes.length);
      if (!await this.work.equal(bytes, before)) throw new PatchError(`target bytes changed since preflight: ${snapshot.path}`);
      position += bytes.length;
    }
  }

  private async parents(path: string): Promise<FileStat> {
    const parts = dirname(path).split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current += "/" + part;
      let stat = await this.stat(current, false);
      if (!stat) {
        try { await this.work.fs(current, () => this.fs.mkdir(current, { signal: this.context.signal })); }
        catch (error) { if (!(error instanceof FileFailure && error.error.code === "EEXIST")) throw error; }
        stat = await this.stat(current, false);
      }
      if (stat?.type !== "directory") throw new PatchError(`parent is not a directory: ${current}`);
    }
    const parent = await this.stat(dirname(path), false);
    if (parent?.type !== "directory") throw new PatchError(`parent is not a directory: ${dirname(path)}`);
    return parent;
  }

  private async write(path: string, output: IndexedDocument, parent: FileStat, expected: FileStat | undefined): Promise<void> {
    let staging: FileStaging | undefined;
    const signal = this.context.signal;
    try {
      await this.work.fs(path, async () => {
        staging = await this.fs.createStagedFile!(`${dirname(path) === "/" ? "" : dirname(path)}/.apply-patch-${globalThis.crypto.randomUUID()}`, "file",
          { type: "file", data: new Uint8Array() }, { parent, retainCleanup: true, signal, ...(expected ? { atimeMs: expected.atimeMs } : {}) });
      });
      if (!staging?.writer || !staging.cleanup) throw new PatchError("filesystem does not support retained staging writes");
      for await (const bytes of output.range(0, output.size)) await this.work.fs(path, () => staging!.writer!.write(bytes, { signal }));
      const stat = await this.work.fs(path, () => staging!.writer!.finish({ signal }));
      const sealed = { ...staging, file: { ...staging.file, stat } };
      await this.work.fs(path, () => this.fs.publishStagedFile!(sealed, path, {
        parent, destination: expected ?? null, ...(expected ? { preserveIdentity: true } : {}), signal,
      }));
    } finally {
      if (staging?.cleanup) await staging.cleanup.remove();
      else if (staging) await this.fs.removeStagedFile?.(staging);
    }
  }

  private async publish(plans: readonly Plan[]): Promise<void> {
    for (let index = 0; index < plans.length; index++) {
      this.ordinal = index + 1;
      const { file, original, output } = plans[index]!;
      if (original) await this.unchanged(original);
      else if (await this.inspect(file.path, false)) throw new PatchError(`new target appeared: ${file.path}`);
      if (file.kind === "delete") {
        await this.work.fs(file.path, () => this.fs.removeFileConditional!(file.path, { signal: this.context.signal, parent: this.initial.get(dirname(file.path))!, expected: original!.stat }));
      } else if (file.destination) {
        if (await this.inspect(file.destination, false)) throw new PatchError(`Move destination appeared: ${file.destination}`);
        const parent = await this.parents(file.destination);
        await this.write(file.destination, output!, parent, undefined);
        await this.unchanged(original!);
        await this.work.fs(file.path, () => this.fs.removeFileConditional!(file.path, { signal: this.context.signal, parent: this.initial.get(dirname(file.path))!, expected: original!.stat }));
      } else if (!original || !await this.equal(original.document!, output!)) {
        const parent = await this.parents(file.path);
        await this.write(file.path, output!, parent, original?.stat);
      }
    }
  }

  async run(): Promise<{ exitCode: number }> {
    const { context, work } = this;
    work.check();
    context.registerCleanup?.(work.close);
    let summary: Uint8Array;
    try {
      try {
        const files = await parse(await this.input(), work);
        await this.confine(files);
        const plans = await this.prepare(files);
        const lines = ["Success. Updated the following files:\n"];
        let bytes = lines[0]!.length;
        for (const file of files) {
          const line = `${file.kind === "add" ? "A" : file.kind === "delete" ? "D" : "M"} ${file.destinationLabel ?? file.label}\n`;
          bytes += await work.utf8(line, work.limits.maxOutputBytes - bytes);
          lines.push(line);
        }
        if (bytes > work.limits.maxOutputBytes) throw new PatchError("maxOutputBytes limit exceeded");
        await work.charge(bytes * 2);
        summary = bytesFrom(lines.join(""));
        await work.checkpoint();
        await this.publish(plans);
        work.check();
      } catch (error) {
        context.signal.throwIfAborted();
        if (!(error instanceof PatchError) && !(error instanceof FileFailure)) throw error;
        await writeBytes(context.stderr, diagnostic(error, work.limits.maxDiagnosticBytes, this.ordinal), context.signal);
        return { exitCode: error instanceof PatchError ? error.status : 1 };
      }
      const operation = createOutputOperation(context, context.stdout);
      try {
        for (let offset = 0; offset < summary.length; offset += 16 * 1024) {
          await writeBytes(operation.output, summary.subarray(offset, offset + 16 * 1024), operation.signal);
        }
      } finally { await operation.close(); }
      return { exitCode: 0 };
    } finally {
      try { await closeDocumentResources([...this.documents]); }
      finally { work.close(); }
    }
  }
}

export function execute(context: CommandContext, limits: ApplyPatchLimits): Promise<{ exitCode: number }> {
  const profile = (context.capabilities?.commandLimits as { applyPatch?: Partial<ApplyPatchLimits> } | undefined)?.applyPatch;
  const effective = { ...limits };
  if (profile) {
    settings({ limits: profile });
    for (const key of Object.keys(profile) as (keyof ApplyPatchLimits)[]) effective[key] = Math.min(effective[key], profile[key]!);
  }
  return new Invocation(context, effective).run();
}
