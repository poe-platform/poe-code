import {
  createOutputOperation, dirname, readBytes, writeBytes,
  type CommandContext, type FileStat, type FileSystem,
} from "../../contracts/index.js";
import type { ApplyPatchLimits } from "./options.js";
import { parse, type PatchFile } from "./parser.js";
import { contents } from "./matcher.js";
import { diagnostic, FileFailure, PatchError, Work } from "./shared.js";

interface Snapshot { readonly path: string; readonly stat: FileStat; bytes?: Uint8Array; }
interface Plan { readonly file: PatchFile; readonly original?: Snapshot; readonly output?: Uint8Array; }

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

  constructor(readonly context: CommandContext, limits: ApplyPatchLimits) {
    this.work = new Work(context, limits);
    this.fs = context.fs;
  }

  private async confine(files: readonly PatchFile[]): Promise<void> {
    if (!this.fs.confineExtraction) throw new PatchError("filesystem does not support race-safe patch mutations");
    if (!this.fs.writeFileConditional || !this.fs.removeFileConditional) throw new PatchError("filesystem does not support conditional patch mutations");
    const roots = new Set<string>();
    for (const file of files) for (const path of [file.path, file.destination]) {
      if (!path) continue;
      const capabilities = await this.work.fs(path, async () => await this.fs.capabilitiesFor?.(path, { signal: this.context.signal }) ?? this.fs.capabilities);
      if (capabilities.atomicFileMutation !== true) throw new PatchError("filesystem does not support atomic conditional patch mutations");
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
      await work.utf8(text, work.limits.maxPatchBytes, 2);
      return text;
    }
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of readBytes(context.stdin, context.signal)) {
      work.count("maxInputChunks", 1);
      if (chunk.byteLength > work.limits.maxPatchBytes - bytes) throw new PatchError("maxPatchBytes limit exceeded");
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

  private async read(path: string): Promise<Uint8Array> {
    const maximum = Math.min(this.work.limits.maxFileBytes, this.work.remaining("maxReadBytes"));
    const bytes = await this.work.fs(path, () => this.fs.readFile(path, { signal: this.context.signal, ...(Number.isFinite(maximum) ? { maxBytes: maximum } : {})}));
    if (!(bytes instanceof Uint8Array)) throw new TypeError("FileSystem.readFile must return Uint8Array");
    if (bytes.length > maximum) throw new PatchError("target read byte limit exceeded");
    this.work.count("maxReadBytes", bytes.length);
    return this.work.copy(bytes);
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
    for (const snapshot of snapshots) snapshot.bytes = await this.read(snapshot.path);
    const plans: Plan[] = [];
    for (const file of files) {
      const original = byPath.get(file.path);
      const output = await contents(file, original?.bytes, this.work);
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
    if (!await this.work.equal(await this.read(snapshot.path), snapshot.bytes!)) throw new PatchError(`target bytes changed since preflight: ${snapshot.path}`);
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
        await this.work.fs(file.destination, () => this.fs.writeFileConditional!(file.destination!, output!, { signal: this.context.signal, parent, expected: null }));
        await this.unchanged(original!);
        await this.work.fs(file.path, () => this.fs.removeFileConditional!(file.path, { signal: this.context.signal, parent: this.initial.get(dirname(file.path))!, expected: original!.stat }));
      } else if (!original || !await this.work.equal(original.bytes!, output!)) {
        const parent = await this.parents(file.path);
        await this.work.fs(file.path, () => this.fs.writeFileConditional!(file.path, output!, { signal: this.context.signal, parent, expected: original?.stat ?? null }));
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
        summary = Buffer.from(lines.join(""));
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
    } finally { work.close(); }
  }
}

export function execute(context: CommandContext, limits: ApplyPatchLimits): Promise<{ exitCode: number }> {
  return new Invocation(context, limits).run();
}
