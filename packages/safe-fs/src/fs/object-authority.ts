import { platform } from "#safe-fs-platform";
import { FsError } from "../contracts/errors.js";
import type { FileSystem } from "../contracts/filesystem.js";
import { BytePath, decodeFileOffset, encodeFileOffset, decodeObjectMetadata, encodeFileTimestamp } from "../contracts/object.js";
import type { ObjectFileSystem, ObjectFileType, WireObjectMetadata, OpenFileObjectOptions, RetainedFileObject, WireExactFileStat, WireObjectHandle, WireObjectDirectoryEntry } from "../contracts/object.js";

/** One authenticated job/epoch owns one authority. IDs are routing identifiers,
 * not bearer authorization. All admitted operations drain before disposal. */
export class ObjectAuthority {
  readonly #backend: ObjectFileSystem | undefined;
  readonly #maxHandles: number;
  readonly #maxIoBytes: number;
  readonly #prefix = platform.randomUUID();
  readonly #handles = new Map<string, { object: RetainedFileObject; identity: object | symbol; type: ObjectFileType; access: "read" | "write" | "readwrite" }>();
  readonly #identities = new Map<object | symbol, { id: string; references: number }>();
  #sequence = 0;
  #tail: Promise<unknown> = Promise.resolve();
  #disposal: Promise<void> | undefined;

  constructor(filesystem: FileSystem | Pick<FileSystem, "objects">, options: { readonly maxHandles: number; readonly maxIoBytes?: number }) {
    const backend = filesystem.objects;
    // One issued authority keeps its qualified namespace. Bound operations
    // observe live backend state without accepting replacement capabilities.
    if (backend !== undefined) {
      const { open, rename, unlink, readdir, specialFiles } = backend;
      this.#backend = Object.freeze({
        open: open.bind(backend),
        ...(rename === undefined ? {} : { rename: rename.bind(backend) }),
        ...(unlink === undefined ? {} : { unlink: unlink.bind(backend) }),
        ...(readdir === undefined ? {} : { readdir: readdir.bind(backend) }),
        specialFiles: Object.freeze({ ...specialFiles }),
      });
    }
    this.#maxHandles = options.maxHandles;
    this.#maxIoBytes = options.maxIoBytes ?? 1048576;
    if (!Number.isSafeInteger(this.#maxHandles) || this.#maxHandles < 1 ||
        !Number.isSafeInteger(this.#maxIoBytes) || this.#maxIoBytes < 1) throw new FsError("EINVAL");
  }

  #run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#disposal) return Promise.reject(new FsError("EBADF"));
    const result = this.#tail.then(operation);
    this.#tail = result.catch(() => {});
    return result;
  }

  #lookup(handle: string, access?: "read" | "write"): RetainedFileObject {
    const retained = this.#handles.get(handle);
    if (!retained || (access && retained.access !== access && retained.access !== "readwrite")) throw new FsError("EBADF");
    return retained.object;
  }

  async open(path: BytePath, options: OpenFileObjectOptions = {}): Promise<WireObjectHandle> {
    const ownedPath = new BytePath(BytePath.prototype.bytes.call(path));
    const admission = Object.freeze({ ...options });
    return this.#run(async () => {
      if ((admission.access !== undefined && !["read", "write", "readwrite"].includes(admission.access)) ||
          (admission.special !== undefined && !["character", "fifo", "socket"].includes(admission.special))) throw new FsError("EINVAL");
      const backend = this.#backend;
      if (!backend || (admission.special && backend.specialFiles?.[admission.special] !== true)) throw new FsError("ENOTSUP");
      if (this.#handles.size >= this.#maxHandles) throw new FsError("EMFILE");
      const acquired = await backend.open(ownedPath, admission);
      // Own cleanup before inspecting admission properties. Keep the acquired
      // receiver and operations even if its public method table later changes.
      const close = acquired.close.bind(acquired);
      try {
        const token = acquired.identity;
        const type = acquired.type;
        if ((typeof token !== "object" && typeof token !== "symbol") || token === null) throw new FsError("ENOTSUP");
        if (admission.special ? type !== admission.special : !["file", "directory", "symlink"].includes(type)) throw new FsError("ENOTSUP");
        const { read, write, append, truncate, metadata, link } = acquired;
        const object: RetainedFileObject = Object.freeze({
          identity: token, type, close,
          stat: acquired.stat.bind(acquired),
          ...(read === undefined ? {} : { read: read.bind(acquired) }),
          ...(write === undefined ? {} : { write: write.bind(acquired) }),
          ...(append === undefined ? {} : { append: append.bind(acquired) }),
          ...(truncate === undefined ? {} : { truncate: truncate.bind(acquired) }),
          ...(metadata === undefined ? {} : { metadata: metadata.bind(acquired) }),
          ...(link === undefined ? {} : { link: link.bind(acquired) }),
        });
        let identity = this.#identities.get(token);
        if (!identity) {
          identity = { id: `${this.#prefix}:o${++this.#sequence}`, references: 0 };
          this.#identities.set(token, identity);
        }
        identity.references++;
        const handle = `${this.#prefix}:h${++this.#sequence}`;
        this.#handles.set(handle, { object, identity: token, type, access: admission.access ?? "read" });
        return { handle, object: identity.id };
      } catch (error) {
        try { await close(); } catch (closeError) { throw new AggregateError([error, closeError]); }
        throw error;
      }
    });
  }

  read(handle: string, position: string, maxBytes: number): Promise<Uint8Array> {
    return this.#run(async () => {
      const object = this.#lookup(handle, "read");
      const offset = decodeFileOffset(position);
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > this.#maxIoBytes) throw new FsError("EINVAL");
      if (!object.read) throw new FsError("ENOTSUP");
      const bytes = await object.read(offset, maxBytes);
      if (!(bytes instanceof Uint8Array)) throw new FsError("EIO");
      const length = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")!.get!.call(bytes) as number;
      if (length > maxBytes) throw new FsError("EIO");
      return new Uint8Array(bytes);
    });
  }

  #ownedWriteBytes(bytes: Uint8Array): Uint8Array {
    if (!(bytes instanceof Uint8Array)) throw new FsError("EINVAL");
    // Caller properties cannot redefine the span admitted before allocation.
    const length = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")!.get!.call(bytes) as number;
    if (length > this.#maxIoBytes) throw new FsError("EINVAL");
    return new Uint8Array(bytes);
  }

  async write(handle: string, position: string, bytes: Uint8Array): Promise<number> {
    const owned = this.#ownedWriteBytes(bytes);
    return this.#run(async () => {
      const object = this.#lookup(handle, "write");
      const offset = decodeFileOffset(position);
      if (!object.write) throw new FsError("ENOTSUP");
      const count = await object.write(offset, owned);
      if (!Number.isSafeInteger(count) || count < 0 || count > owned.byteLength) throw new FsError("EIO");
      return count;
    });
  }

  async append(handle: string, bytes: Uint8Array): Promise<number> {
    const owned = this.#ownedWriteBytes(bytes);
    return this.#run(async () => {
      const object = this.#lookup(handle, "write");
      if (!object.append) throw new FsError("ENOTSUP", { syscall: "append" });
      const count = await object.append(owned);
      if (!Number.isSafeInteger(count) || count < 0 || count > owned.byteLength) throw new FsError("EIO");
      return count;
    });
  }

  truncate(handle: string, length: string): Promise<void> {
    return this.#run(async () => {
      const object = this.#lookup(handle, "write");
      const size = decodeFileOffset(length);
      if (!object.truncate) throw new FsError("ENOTSUP");
      await object.truncate(size);
    });
  }

  metadata(handle: string, changes: WireObjectMetadata): Promise<void> {
    if (typeof changes !== "object" || changes === null || Array.isArray(changes)) return Promise.reject(new FsError("EINVAL"));
    const owned = { ...changes };
    return this.#run(async () => {
      const object = this.#lookup(handle);
      if (!object.metadata) throw new FsError("ENOTSUP");
      await object.metadata(decodeObjectMetadata(owned));
    });
  }

  async link(handle: string, destination: BytePath): Promise<void> {
    const ownedDestination = new BytePath(BytePath.prototype.bytes.call(destination));
    return this.#run(async () => {
      const object = this.#lookup(handle);
      if (!object.link) throw new FsError("ENOTSUP");
      await object.link(ownedDestination);
    });
  }

  stat(handle: string): Promise<WireExactFileStat> {
    return this.#run(async () => {
      const object = this.#lookup(handle);
      const value = await object.stat();
      const { type, size, allocatedBytes, nlink, atimeNs, mtimeNs, ctimeNs, mode, uid, gid } = value;
      if (type !== this.#handles.get(handle)!.type) throw new FsError("EIO");
      for (const [field, maximum] of [[mode, 65535], [uid, 4294967295], [gid, 4294967295]] as const) {
        if (field !== undefined && (!Number.isSafeInteger(field) || field < 0 || field > maximum)) throw new FsError("EINVAL");
      }
      return {
        type, size: encodeFileOffset(size),
        ...(mode === undefined ? {} : { mode }),
        ...(uid === undefined ? {} : { uid }),
        ...(gid === undefined ? {} : { gid }),
        ...(allocatedBytes === undefined ? {} : { allocatedBytes: encodeFileOffset(allocatedBytes) }),
        ...(nlink === undefined ? {} : { nlink: encodeFileOffset(nlink) }),
        ...(atimeNs === undefined ? {} : { atimeNs: encodeFileTimestamp(atimeNs) }),
        ...(mtimeNs === undefined ? {} : { mtimeNs: encodeFileTimestamp(mtimeNs) }),
        ...(ctimeNs === undefined ? {} : { ctimeNs: encodeFileTimestamp(ctimeNs) }),
      };
    });
  }

  async rename(source: BytePath, destination: BytePath): Promise<void | { readonly moved: boolean }> {
    const ownedSource = new BytePath(BytePath.prototype.bytes.call(source));
    const ownedDestination = new BytePath(BytePath.prototype.bytes.call(destination));
    return this.#run(async () => {
      const backend = this.#backend;
      if (!backend?.rename) throw new FsError("ENOTSUP");
      return await backend.rename(ownedSource, ownedDestination);
    });
  }

  async unlink(path: BytePath): Promise<void> {
    const ownedPath = new BytePath(BytePath.prototype.bytes.call(path));
    return this.#run(async () => {
      const backend = this.#backend;
      if (!backend?.unlink) throw new FsError("ENOTSUP");
      await backend.unlink(ownedPath);
    });
  }

  async readdir(path: BytePath, maxEntries: number): Promise<readonly WireObjectDirectoryEntry[]> {
    const ownedPath = new BytePath(BytePath.prototype.bytes.call(path));
    return this.#run(async () => {
      if (!Number.isSafeInteger(maxEntries) || maxEntries < 0) throw new FsError("EINVAL");
      const backend = this.#backend;
      if (!backend?.readdir) throw new FsError("ENOTSUP");
      const entries = await backend.readdir(ownedPath, { maxEntries });
      if (!Array.isArray(entries)) throw new FsError("EIO");
      const length = entries.length;
      if (length > maxEntries) throw new FsError("EFBIG");
      return Array.from({ length }, (_, index) => {
        if (!Object.hasOwn(entries, index)) throw new FsError("EIO");
        const entry = entries[index];
        if (!entry) throw new FsError("EIO");
        const { name: component, type } = entry;
        if (typeof component?.bytes !== "function" ||
            !["file", "directory", "symlink", "character", "fifo", "socket"].includes(type)) throw new FsError("EIO");
        const carrier = component.bytes();
        if (!(carrier instanceof Uint8Array)) throw new FsError("EIO");
        const bytes = new Uint8Array(carrier);
        if (!bytes.length || bytes.includes(0) || bytes.includes(47) ||
            (bytes[0] === 46 && (bytes.length === 1 || (bytes.length === 2 && bytes[1] === 46)))) throw new FsError("EIO");
        const name = Array.from(bytes);
        return { name, type };
      });
    });
  }

  close(handle: string): Promise<void> {
    return this.#run(async () => {
      const object = this.#lookup(handle);
      const token = this.#handles.get(handle)!.identity;
      this.#handles.delete(handle);
      const identity = this.#identities.get(token)!;
      if (--identity.references === 0) this.#identities.delete(token);
      await object.close();
    });
  }

  dispose(): Promise<void> {
    this.#disposal ??= this.#tail.then(async () => {
      const objects = [...this.#handles.values()].map(retained => retained.object);
      this.#handles.clear(); this.#identities.clear();
      const results = await Promise.allSettled(objects.map(async object => { await object.close(); }));
      const failures = results.filter(result => result.status === "rejected");
      if (failures.length) throw new AggregateError(failures.map(result => result.reason), "Object cleanup failed");
    });
    return this.#disposal;
  }
}
