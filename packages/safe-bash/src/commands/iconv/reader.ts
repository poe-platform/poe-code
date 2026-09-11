import { FsError, resolvePath, type ByteSource } from "../../contracts/index.js";
import { pathText } from "./internal.js";
import { Lifecycle } from "./lifecycle.js";

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const viewBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!;
const viewOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")!.get!;
const viewLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!;

export class Reader {
  private iterator: AsyncIterator<Uint8Array> | undefined;
  private ended = false;
  private retained = 0;
  private closed: Promise<void> | undefined;
  private readonly chunks: Uint8Array[] = [];
  private content: Uint8Array | undefined;
  private readError: FsError | undefined;
  stage: "open" | "read" = "open";
  constructor(readonly name: string, readonly lifecycle: Lifecycle) { lifecycle.budget.retain(256); lifecycle.cleanup(this.close); }
  readonly close = (): Promise<void> => this.closed ??= Promise.resolve().then(async () => {
    try { if (!this.ended) await this.iterator?.return?.(); }
    finally {
      this.iterator = undefined; this.content = undefined; this.chunks.length = 0;
      this.lifecycle.budget.retain(-this.retained - 256); this.retained = 0;
      this.lifecycle.forget(this.close);
    }
  });
  private copy(value: Uint8Array): Uint8Array {
    if (!(value instanceof Uint8Array)) throw new TypeError("iconv input requires bytes");
    const buffer = viewBuffer.call(value) as ArrayBuffer;
    const offset = viewOffset.call(value) as number;
    const size = viewLength.call(value) as number;
    this.lifecycle.assertOpen();
    this.lifecycle.budget.inputBytes(size);
    this.lifecycle.budget.retain(size);
    try {
      const copy = new Uint8Array(new Uint8Array(buffer, offset, size));
      this.retained += size;
      return copy;
    } catch (error) {
      this.lifecycle.budget.retain(-size);
      throw error;
    }
  }
  async open(): Promise<void> {
    const { budget } = this.lifecycle;
    await this.lifecycle.operation(async () => {
      let source: ByteSource;
      let needsAcquisitionCleanup = false;
      if (this.name === "-") { source = budget.context.stdin; this.stage = "read"; }
      else {
        if (this.name === "") throw new FsError("ENOENT", { path: "" });
        const cwd = budget.context.cwd;
        this.lifecycle.assertOpen();
        const path = resolvePath(cwd, pathText(this.name));
        const fs = budget.context.fs;
        this.lifecycle.assertOpen();
        const statMethod = fs.stat;
        this.lifecycle.assertOpen();
        const stat = await Reflect.apply(statMethod, fs, [path, { signal: budget.signal }]);
        this.lifecycle.assertOpen();
        const type = stat.type;
        this.lifecycle.assertOpen();
        if (this.name.endsWith("/") && type !== "directory") throw new FsError("ENOTDIR", { path });
        this.stage = "read";
        if (type === "directory") { this.readError = new FsError("EISDIR", { path }); return; }
        if (type !== "file" && type !== "character") throw new FsError("ENOTSUP", { path });
        const capabilitiesFor = fs.capabilitiesFor;
        this.lifecycle.assertOpen();
        const selected = capabilitiesFor ? await Reflect.apply(capabilitiesFor, fs, [path, { signal: budget.signal }]) : undefined;
        this.lifecycle.assertOpen();
        const capabilities = selected ?? fs.capabilities;
        this.lifecycle.assertOpen();
        const streamingRead = capabilities.streamingRead;
        this.lifecycle.assertOpen();
        const readStream = fs.readStream;
        this.lifecycle.assertOpen();
        if (readStream && streamingRead !== false) {
          source = Reflect.apply(readStream, fs, [path, { signal: budget.signal, chunkSize: 16_384 }]);
          needsAcquisitionCleanup = budget.signal.aborted || budget.admission.closed;
        } else {
          const maximum = budget.snapshotMaximum();
          const size = stat.size;
          this.lifecycle.assertOpen();
          budget.check(size, maximum, "buffered input bytes");
          budget.retain(maximum);
          try {
            const readFile = fs.readFile;
            this.lifecycle.assertOpen();
            const content = await Reflect.apply(readFile, fs, [path, { signal: budget.signal, maxBytes: maximum }]);
            this.lifecycle.assertOpen();
            if (!(content instanceof Uint8Array)) throw new TypeError("iconv input requires bytes");
            const length = viewLength.call(content) as number;
            this.lifecycle.assertOpen();
            budget.check(length, maximum, "buffered input bytes");
            this.content = this.copy(content); this.ended = true;
          } finally { budget.retain(-maximum); }
          return;
        }
      }
      if (!needsAcquisitionCleanup) this.lifecycle.assertOpen();
      const factory = source[Symbol.asyncIterator];
      if (!needsAcquisitionCleanup) this.lifecycle.assertOpen();
      this.iterator = Reflect.apply(factory, source, []);
    });
  }
  async all(): Promise<Uint8Array> {
    if (this.readError) throw this.readError;
    if (this.content) return this.content;
    const { budget } = this.lifecycle;
    let length = 0;
    while (!this.ended) {
      const result = await this.lifecycle.operation(() => {
        const iterator = this.iterator!;
        const next = iterator.next;
        this.lifecycle.assertOpen();
        return Reflect.apply(next, iterator, []);
      });
      const done = result.done;
      this.lifecycle.assertOpen();
      if (done) { this.ended = true; this.iterator = undefined; break; }
      const value = result.value;
      this.lifecycle.assertOpen();
      const owned = this.copy(value);
      budget.retain(64); this.retained += 64;
      this.chunks.push(owned); length += owned.length;
      await budget.checkpointWork();
    }
    budget.retain(length); this.retained += length;
    const content = new Uint8Array(length);
    let offset = 0;
    for (const chunk of this.chunks) { content.set(chunk, offset); offset += chunk.length; budget.charge(chunk.length + 1); await budget.checkpointWork(); }
    budget.retain(-length - this.chunks.length * 64); this.retained -= length + this.chunks.length * 64;
    this.chunks.length = 0; this.content = content;
    return content;
  }
}

export function fsDetail(error: FsError): string {
  const details: Partial<Record<FsError["code"], string>> = {
    EACCES: "Permission denied", EPERM: "Operation not permitted", ENOENT: "No such file or directory",
    EISDIR: "Is a directory", ENOTDIR: "Not a directory", EIO: "Input/output error", ELOOP: "Too many levels of symbolic links",
    ENAMETOOLONG: "File name too long", ENOTSUP: "Operation not supported",
  };
  return details[error.code] ?? error.message;
}
